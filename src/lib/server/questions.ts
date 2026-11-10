// Building questions and planning a session. See PLAN.md sections 2.1 and 2.2.
// Everything here is pure; randomness comes in through an `rng` argument so tests can fix it.

import type { PlanItem, QuestionType } from './db/schema.ts';

export type { PlanItem, QuestionType };

export interface WordInfo {
	id: number;
	listId: number;
	grade: number;
	word: string;
	partOfSpeech: string;
	definition: string;
	sentence: string;
	synonyms: string[];
}

/** Returns a number from 0 (inclusive) to 1 (exclusive), like Math.random. */
export type Rng = () => number;

export const BLANK = '_____';
export const WRONG_CHOICES = 3;

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index--) {
		const other = Math.floor(rng() * (index + 1));
		[result[index], result[other]] = [result[other], result[index]];
	}
	return result;
}

/** Harder kinds of question as a word becomes familiar. */
export function typeForBox(box: number, spellingEnabled: boolean): QuestionType {
	if (box <= 2) return 'word_to_def';
	if (box === 3) return 'def_to_word';
	if (box === 4) return 'cloze';
	return spellingEnabled ? 'spell' : 'cloze';
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The example sentence with the word taken out, for fill-in-the-blank questions. */
export function blankSentence(sentence: string, word: string): string {
	return sentence.replace(
		new RegExp(`(?<![A-Za-z])${escapeRegExp(word)}(?![A-Za-z])`, 'gi'),
		BLANK
	);
}

const areSynonyms = (a: WordInfo, b: WordInfo) =>
	a.synonyms.includes(b.word) || b.synonyms.includes(a.word);

/**
 * Picks the wrong choices for a question about `target`.
 *
 * The best wrong choices come from the same list and are the same part of speech, so
 * grammar alone never gives the answer away. A synonym is never used: it would be a
 * second right answer. If a small list cannot supply enough, the search widens to the
 * same grade, then any list, and only as a last resort to other parts of speech.
 *
 * `shows` says what the child will see for each choice, so two choices never look alike.
 */
export function pickDistractors(
	target: WordInfo,
	pool: readonly WordInfo[],
	rng: Rng,
	shows: (word: WordInfo) => string = (word) => word.word,
	count = WRONG_CHOICES
): WordInfo[] {
	const usable = pool.filter((word) => word.id !== target.id && !areSynonyms(target, word));
	const samePart = (word: WordInfo) => word.partOfSpeech === target.partOfSpeech;
	const tiers = [
		usable.filter((word) => samePart(word) && word.listId === target.listId),
		usable.filter((word) => samePart(word) && word.grade === target.grade),
		usable.filter(samePart),
		usable
	];

	const picked: WordInfo[] = [];
	const seen = new Set([shows(target)]);
	for (const tier of tiers) {
		for (const word of shuffle(tier, rng)) {
			if (picked.length === count) return picked;
			if (seen.has(shows(word))) continue;
			seen.add(shows(word));
			picked.push(word);
		}
	}
	return picked;
}

export interface BuiltQuestion {
	type: QuestionType;
	/** What the child chooses between, already shuffled. Empty for a spelling question. */
	choices: string[];
	/** Kept on the server and never sent with the question. */
	correctChoice: string;
}

export function buildQuestion(
	target: WordInfo,
	type: QuestionType,
	pool: readonly WordInfo[],
	rng: Rng
): BuiltQuestion {
	if (type === 'spell') return { type, choices: [], correctChoice: target.word };

	// "What does this word mean?" offers definitions; the other kinds offer words.
	const shows = (word: WordInfo) => (type === 'word_to_def' ? word.definition : word.word);
	const wrong = pickDistractors(target, pool, rng, shows);
	return {
		type,
		choices: shuffle([target, ...wrong], rng).map(shows),
		correctChoice: shows(target)
	};
}

/** What is sent to the browser for a question. The answer is deliberately not part of it. */
export type PublicQuestion = { id: number } & (
	| { type: 'word_to_def'; word: string; choices: string[] }
	| { type: 'def_to_word'; definition: string; choices: string[] }
	| { type: 'cloze'; sentence: string; choices: string[] }
	| { type: 'spell'; definition: string; sentence: string; firstLetter: string; length: number }
);

export function publicQuestion(
	id: number,
	type: QuestionType,
	target: WordInfo,
	choices: string[]
): PublicQuestion {
	switch (type) {
		case 'word_to_def':
			return { id, type, word: target.word, choices };
		case 'def_to_word':
			return { id, type, definition: target.definition, choices };
		case 'cloze':
			return { id, type, sentence: blankSentence(target.sentence, target.word), choices };
		case 'spell':
			// A definition alone could fit several words, so the first letter and the
			// length point to the one that is wanted without spelling it out.
			return {
				id,
				type,
				definition: target.definition,
				sentence: blankSentence(target.sentence, target.word),
				firstLetter: target.word[0],
				length: target.word.length
			};
	}
}

export const SPELLING_MAX_LENGTH = 40;

/** Typed answers are compared without regard to capitals or stray spaces. */
export function normalizeSpelling(text: string): string {
	return text.normalize('NFKC').trim().toLowerCase();
}

export function isCorrect(type: QuestionType, correctChoice: string, chosen: string): boolean {
	return type === 'spell'
		? normalizeSpelling(chosen) === normalizeSpelling(correctChoice)
		: chosen === correctChoice;
}

export interface PlanInput {
	/** Words whose review is due, most overdue first, with their current box. */
	due: { wordId: number; box: number }[];
	/** Words the child has never seen, in the order to introduce them. */
	fresh: number[];
	/** Words being learned that are not due yet, soonest first. Used only to fill a short session. */
	early: { wordId: number; box: number }[];
	questionsPerSession: number;
	newWordsPerSession: number;
	spellingEnabled: boolean;
}

/**
 * Decides which questions a session will ask.
 *
 * 1. Reviews that are due come first.
 * 2. Then new words, up to the per-session limit, if there is room.
 * 3. If the session is still short (as it always is in the first days), it is filled
 *    with extra practice: first words that are not quite due, then a second and third
 *    look at this session's words asked in a different way. Meeting a new word three
 *    ways in one sitting is how it starts to stick. Extra practice never moves a word
 *    up a box (see srs.ts).
 */
export function composePlan(input: PlanInput): PlanItem[] {
	const size = input.questionsPerSession;
	const plan: PlanItem[] = [];
	const room = () => size - plan.length;
	const typeFor = (box: number) => typeForBox(box, input.spellingEnabled);

	for (const { wordId, box } of input.due.slice(0, size)) {
		plan.push({ wordId, type: typeFor(box) });
	}

	const newWords = input.fresh.slice(0, Math.max(0, Math.min(input.newWordsPerSession, room())));
	for (const wordId of newWords) plan.push({ wordId, type: 'word_to_def' });

	const planned = new Set(plan.map((item) => item.wordId));
	for (const { wordId, box } of input.early) {
		if (room() <= 0) break;
		if (planned.has(wordId)) continue;
		planned.add(wordId);
		plan.push({ wordId, type: typeFor(box) });
	}

	// Newest words get the extra looks first: they need them most.
	const words = [
		...newWords,
		...plan.map((item) => item.wordId).filter((id) => !newWords.includes(id))
	];
	for (const type of ['def_to_word', 'cloze'] as const) {
		for (const wordId of words) {
			if (room() <= 0) return plan;
			if (plan.some((item) => item.wordId === wordId && item.type === type)) continue;
			plan.push({ wordId, type });
		}
	}
	return plan;
}

/** A missed word is asked again after this many other questions, when there are that many. */
export const RETRY_GAP = 2;
/** A word is asked at most this many times in one session, however often it is missed. */
export const MAX_ASKS_PER_WORD = 4;

/**
 * After a wrong answer at `position`, adds the word to the plan again a little further on.
 * Nothing is added if the word is already coming up again, or has been asked enough.
 */
export function withRetry(plan: readonly PlanItem[], position: number, wordId: number): PlanItem[] {
	const comingUp = plan.slice(position + 1).some((item) => item.wordId === wordId);
	const asks = plan.filter((item) => item.wordId === wordId).length;
	if (comingUp || asks >= MAX_ASKS_PER_WORD) return [...plan];

	const at = Math.min(position + 1 + RETRY_GAP, plan.length);
	return [...plan.slice(0, at), { wordId, type: 'word_to_def' }, ...plan.slice(at)];
}
