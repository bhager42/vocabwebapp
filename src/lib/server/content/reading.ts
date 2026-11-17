// Validation rules for the built-in reading stories. See PLAN.md Phase 12.
//
// This module is pure (no file or database access) so every rule can be unit-tested.
// The rules catch mechanical mistakes; whether a story makes sense and its questions
// are fair is decided by review (content/reading/REVIEW.md), not here.

import { blockedWords } from './validate.ts';

export const QUESTION_KINDS = [
	'literal',
	'inference',
	'vocabulary',
	'main_idea',
	'sequence'
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export interface StoryQuestion {
	kind: QuestionKind;
	prompt: string;
	correct: string;
	wrong: string[];
	explanation: string;
	evidence: string[];
}

export interface Story {
	id: string;
	title: string;
	paragraphs: string[];
	questions: StoryQuestion[];
}

export interface GradeStories {
	grade: number;
	stories: Story[];
}

export type ReadingRule =
	| 'shape'
	| 'id-format'
	| 'duplicate-id'
	| 'paragraph-count'
	| 'word-count'
	| 'readability'
	| 'question-count'
	| 'question-kinds'
	| 'choices'
	| 'evidence'
	| 'inference-stated'
	| 'answer-length'
	| 'blocked-word';

export interface ReadingIssue {
	grade: number;
	/** Empty for issues about the grade as a whole. */
	story: string;
	rule: ReadingRule;
	message: string;
}

export interface GradeLimits {
	paragraphs: [number, number];
	words: [number, number];
	readability: [number, number];
}

/** Size and reading level per grade. See the table in PLAN.md Phase 12. */
export const LIMITS: Record<number, GradeLimits> = {
	3: { paragraphs: [3, 5], words: [200, 400], readability: [2, 4] },
	4: { paragraphs: [3, 6], words: [250, 500], readability: [3, 5] },
	5: { paragraphs: [4, 6], words: [300, 600], readability: [4, 6] },
	6: { paragraphs: [4, 7], words: [350, 700], readability: [5, 7] }
};

export const QUESTIONS_PER_STORY = 5;
export const WRONG_PER_QUESTION = 3;

// ---- Measuring text ----

const wordsOf = (text: string) => text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? [];

export const countWords = (text: string) => wordsOf(text).length;

/**
 * Syllables in an English word, by the usual rule of thumb: count groups of vowels,
 * drop a silent final "e", and count at least one. Good enough for a readability guide.
 */
export function syllables(word: string): number {
	const lower = word.toLowerCase().replace(/['’]s?$/, '');
	if (lower.length <= 3) return 1;
	const trimmed = lower
		.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, (end) => end[0])
		.replace(/^y/, '');
	const groups = trimmed.match(/[aeiouy]{1,2}/g)?.length ?? 0;
	return Math.max(1, groups);
}

/**
 * Sentences end at . ! or ?, possibly followed by a closing quote, when what comes next
 * starts a new sentence. In `"Stop!" she said.` the "!" does not end the sentence.
 */
export function countSentences(text: string): number {
	const ends = text.match(/[.!?]+["”’']?(?=\s+[^\sa-z]|\s*$)/g)?.length ?? 0;
	return Math.max(1, ends);
}

/** The Flesch-Kincaid grade level of a passage. */
export function readability(text: string): number {
	const words = wordsOf(text);
	if (words.length === 0) return 0;
	const syllableCount = words.reduce((total, word) => total + syllables(word), 0);
	return (
		0.39 * (words.length / countSentences(text)) + 11.8 * (syllableCount / words.length) - 15.59
	);
}

/** Lower case, curly quotes made straight, and runs of space made single. */
const normalize = (text: string) =>
	text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/** Letters and digits only, for "is this answer written out in the story?". */
const bare = (text: string) =>
	normalize(text)
		.replace(/[^a-z0-9 ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();

// ---- Rules ----

function isText(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

/** Checks one story's shape. Returns a message, or null when the shape is right. */
function shapeProblem(story: Story): string | null {
	if (!isText(story.id) || !isText(story.title)) return 'needs an id and a title';
	if (!Array.isArray(story.paragraphs) || !story.paragraphs.every(isText)) {
		return 'paragraphs must be a list of text';
	}
	if (!Array.isArray(story.questions)) return 'questions must be a list';
	for (const [index, question] of story.questions.entries()) {
		const where = `question ${index + 1}`;
		if (!QUESTION_KINDS.includes(question.kind)) return `${where} has an unknown kind`;
		if (![question.prompt, question.correct, question.explanation].every(isText)) {
			return `${where} needs a prompt, a correct answer and an explanation`;
		}
		if (!Array.isArray(question.wrong) || !question.wrong.every(isText)) {
			return `${where}: wrong must be a list of text`;
		}
		if (!Array.isArray(question.evidence) || !question.evidence.every(isText)) {
			return `${where}: evidence must be a list of text`;
		}
	}
	return null;
}

export function validateStories(grades: readonly GradeStories[]): ReadingIssue[] {
	const issues: ReadingIssue[] = [];
	const seen = new Map<string, number>();

	for (const { grade, stories } of grades) {
		const limits = LIMITS[grade];
		if (!limits) {
			issues.push({
				grade,
				story: '',
				rule: 'shape',
				message: `No limits are set for grade ${grade}.`
			});
			continue;
		}

		for (const story of stories) {
			const add = (rule: ReadingRule, message: string) =>
				issues.push({ grade, story: String(story.id ?? ''), rule, message });

			const shape = shapeProblem(story);
			if (shape) {
				add('shape', shape);
				continue;
			}

			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(story.id)) {
				add(
					'id-format',
					'An id is lower-case letters, digits and hyphens, such as "the-lost-kite".'
				);
			}
			if (seen.has(story.id)) add('duplicate-id', `Also used in grade ${seen.get(story.id)}.`);
			seen.set(story.id, grade);

			const text = story.paragraphs.join('\n\n');
			const [minParagraphs, maxParagraphs] = limits.paragraphs;
			if (story.paragraphs.length < minParagraphs || story.paragraphs.length > maxParagraphs) {
				add(
					'paragraph-count',
					`Has ${story.paragraphs.length} paragraphs; grade ${grade} needs ${minParagraphs} to ${maxParagraphs}.`
				);
			}
			const words = countWords(text);
			if (words < limits.words[0] || words > limits.words[1]) {
				add(
					'word-count',
					`Has ${words} words; grade ${grade} needs ${limits.words[0]} to ${limits.words[1]}.`
				);
			}
			const level = readability(text);
			if (level < limits.readability[0] || level > limits.readability[1]) {
				add(
					'readability',
					`Reads at grade ${level.toFixed(1)}; grade ${grade} needs ${limits.readability[0]} to ${limits.readability[1]}.`
				);
			}

			// Question counts and kinds.
			const kinds = story.questions.map((question) => question.kind);
			const literal = kinds.filter((kind) => kind === 'literal').length;
			const inference = kinds.filter((kind) => kind === 'inference').length;
			if (story.questions.length !== QUESTIONS_PER_STORY) {
				add(
					'question-count',
					`Has ${story.questions.length} questions; needs ${QUESTIONS_PER_STORY}.`
				);
			}
			if (literal < 2 || inference < 2 || literal + inference === story.questions.length) {
				add(
					'question-kinds',
					'Needs at least 2 literal and 2 inference questions, and one vocabulary, main idea or sequence question.'
				);
			}

			const storyText = normalize(text);
			const storyBare = bare(text);
			story.questions.forEach((question, index) => {
				const where = `Question ${index + 1}`;
				const choices = [question.correct, ...question.wrong];
				if (
					question.wrong.length !== WRONG_PER_QUESTION ||
					new Set(choices.map(normalize)).size !== choices.length
				) {
					add(
						'choices',
						`${where} needs ${WRONG_PER_QUESTION} wrong answers, all different from each other and from the right one.`
					);
				}
				if (question.evidence.length === 0) add('evidence', `${where} has no evidence.`);
				for (const phrase of question.evidence) {
					if (!storyText.includes(normalize(phrase))) {
						add('evidence', `${where}: "${phrase}" is not in the story word for word.`);
					}
				}
				if (question.kind === 'inference' && storyBare.includes(bare(question.correct))) {
					add(
						'inference-stated',
						`${where} is an inference question, but its answer is written in the story.`
					);
				}
				const longestWrong = Math.max(0, ...question.wrong.map(countWords));
				if (countWords(question.correct) > longestWrong * 1.5 + 2) {
					add(
						'answer-length',
						`${where}: the right answer is much longer than the wrong ones, which gives it away.`
					);
				}
			});

			const everything = [
				story.title,
				text,
				...story.questions.flatMap((question) => [
					question.prompt,
					question.correct,
					...question.wrong,
					question.explanation
				])
			].join(' ');
			const blocked = blockedWords(everything);
			if (blocked.length > 0) add('blocked-word', `Uses a blocked word: ${blocked.join(', ')}.`);
		}
	}
	return issues;
}
