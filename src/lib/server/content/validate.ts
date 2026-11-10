// Validation rules for the built-in word lists. See PLAN.md section 2.5.
//
// This module is pure (no file or database access) so every rule can be unit-tested.

export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb'] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

export interface ContentEntry {
	word: string;
	partOfSpeech: PartOfSpeech;
	definition: string;
	sentence: string;
	synonyms: string[];
}

export interface GradeContent {
	grade: number;
	words: ContentEntry[];
}

export type Rule =
	| 'word-format'
	| 'part-of-speech'
	| 'duplicate-word'
	| 'definition-contains-word'
	| 'definition-length'
	| 'sentence-word-count'
	| 'sentence-punctuation'
	| 'synonym-is-word'
	| 'too-few-distractors'
	| 'blocked-word'
	| 'grade-size';

export interface Issue {
	grade: number;
	/** Empty for issues about the grade as a whole. */
	word: string;
	rule: Rule;
	message: string;
}

export interface ValidateOptions {
	/** When set, every grade must have exactly this many words. */
	wordsPerGrade?: number;
}

export const MAX_DEFINITION_WORDS = 15;
/** A multiple-choice question shows the answer plus this many wrong choices. */
export const MIN_DISTRACTORS = 3;

// Deliberately short: a safety net against typos and careless edits, not a content filter.
const BLOCKLIST = [
	'ass',
	'bastard',
	'bitch',
	'crap',
	'damn',
	'dick',
	'fuck',
	'hell',
	'piss',
	'shit',
	'slut',
	'whore'
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Counts whole-word, case-insensitive occurrences of `word` in `text`. */
export function countWord(text: string, word: string): number {
	const pattern = new RegExp(`(?<![A-Za-z])${escapeRegExp(word)}(?![A-Za-z])`, 'gi');
	return text.match(pattern)?.length ?? 0;
}

/**
 * True when `candidate` may be shown as a wrong choice for `target`:
 * a different word with the same part of speech that is not a synonym in either direction.
 */
export function isDistractorFor(target: ContentEntry, candidate: ContentEntry): boolean {
	return (
		candidate.word !== target.word &&
		candidate.partOfSpeech === target.partOfSpeech &&
		!target.synonyms.includes(candidate.word) &&
		!candidate.synonyms.includes(target.word)
	);
}

export function validateContent(grades: GradeContent[], options: ValidateOptions = {}): Issue[] {
	const issues: Issue[] = [];
	const firstSeenInGrade = new Map<string, number>();

	for (const { grade, words } of grades) {
		const report = (word: string, rule: Rule, message: string) =>
			issues.push({ grade, word, rule, message });

		if (options.wordsPerGrade !== undefined && words.length !== options.wordsPerGrade) {
			report('', 'grade-size', `has ${words.length} words, expected ${options.wordsPerGrade}`);
		}

		for (const entry of words) {
			const { word, definition, sentence, synonyms } = entry;

			if (!/^[a-z]+$/.test(word)) {
				report(word, 'word-format', 'must be lower-case letters only');
			}

			if (!PARTS_OF_SPEECH.includes(entry.partOfSpeech)) {
				report(word, 'part-of-speech', `unknown part of speech "${entry.partOfSpeech}"`);
			}

			const earlierGrade = firstSeenInGrade.get(word);
			if (earlierGrade !== undefined) {
				report(word, 'duplicate-word', `already listed in grade ${earlierGrade}`);
			} else {
				firstSeenInGrade.set(word, grade);
			}

			if (countWord(definition, word) > 0) {
				report(word, 'definition-contains-word', 'the definition gives away the word');
			}

			const definitionWords = definition.trim().split(/\s+/).filter(Boolean).length;
			if (definitionWords === 0 || definitionWords > MAX_DEFINITION_WORDS) {
				report(
					word,
					'definition-length',
					`definition has ${definitionWords} words, must be 1 to ${MAX_DEFINITION_WORDS}`
				);
			}

			const uses = countWord(sentence, word);
			if (uses !== 1) {
				report(
					word,
					'sentence-word-count',
					`the sentence uses the word ${uses} times, must be exactly once`
				);
			}

			if (!/[.!?]["']?$/.test(sentence.trim())) {
				report(word, 'sentence-punctuation', 'the sentence must end with . ! or ?');
			}

			if (synonyms.includes(word)) {
				report(word, 'synonym-is-word', 'a word cannot be its own synonym');
			}

			const distractors = words.filter((candidate) => isDistractorFor(entry, candidate)).length;
			if (distractors < MIN_DISTRACTORS) {
				report(
					word,
					'too-few-distractors',
					`only ${distractors} usable wrong choices in grade ${grade}, need ${MIN_DISTRACTORS}`
				);
			}

			for (const blocked of BLOCKLIST) {
				if (countWord(`${word} ${definition} ${sentence} ${synonyms.join(' ')}`, blocked) > 0) {
					report(word, 'blocked-word', `contains the blocked word "${blocked}"`);
				}
			}
		}
	}

	return issues;
}
