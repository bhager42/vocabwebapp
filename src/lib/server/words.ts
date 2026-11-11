// Word lists as the parent manages them. See PLAN.md sections 2.5 and 5.
//
// Built-in lists come from the files in ./content and can only be switched on and off,
// as a whole or word by word. Custom lists are the parent's own: words can be added,
// changed and removed.
//
// Nothing a child has been asked is ever deleted. A word that has been asked can only
// be switched off, because their history refers to it.

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { GRADES } from './children.ts';
import {
	PARTS_OF_SPEECH,
	validateContent,
	type ContentEntry,
	type PartOfSpeech,
	type Rule
} from './content/validate.ts';
import type { Db } from './db/client.ts';
import { question, word, wordList } from './db/schema.ts';

export const LIST_NAME_MAX = 40;
export const WORD_MAX = 30;
export const TEXT_MAX = 200;
/** How many words can be pasted and filled in at one time. */
export const PASTE_MAX = 30;

export type FieldErrors = Record<string, string>;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Db | Tx;

// ---- Reading ----

export interface ListSummary {
	id: number;
	name: string;
	grade: number;
	source: 'builtin' | 'custom';
	active: boolean;
	words: number;
	/** Words that are switched on. */
	activeWords: number;
}

/** Every list: built-in ones by grade, then the parent's own by grade and name. */
export function listWordLists(db: Db): ListSummary[] {
	return db
		.select({
			id: wordList.id,
			name: wordList.name,
			grade: wordList.grade,
			source: wordList.source,
			active: wordList.active,
			words: sql<number>`count(${word.id})`,
			activeWords: sql<number>`coalesce(sum(${word.active}), 0)`
		})
		.from(wordList)
		.leftJoin(word, eq(word.listId, wordList.id))
		.groupBy(wordList.id)
		.orderBy(asc(wordList.source), asc(wordList.grade), asc(wordList.name))
		.all();
}

export interface WordRow {
	id: number;
	word: string;
	partOfSpeech: string;
	definition: string;
	sentence: string;
	synonyms: string[];
	active: boolean;
}

export interface ListDetail extends ListSummary {
	/** In alphabetical order. */
	entries: WordRow[];
}

export function getWordList(db: Db, id: number): ListDetail | null {
	const summary = listWordLists(db).find((list) => list.id === id);
	if (!summary) return null;
	const entries = db
		.select({
			id: word.id,
			word: word.word,
			partOfSpeech: word.partOfSpeech,
			definition: word.definition,
			sentence: word.sentence,
			synonyms: word.synonymsJson,
			active: word.active
		})
		.from(word)
		.where(eq(word.listId, id))
		.orderBy(asc(word.word))
		.all();
	return { ...summary, entries };
}

export function getWord(db: Db, listId: number, wordId: number): WordRow | null {
	return getWordList(db, listId)?.entries.find((entry) => entry.id === wordId) ?? null;
}

/** True when a child has ever been asked the word. */
function hasBeenAsked(db: Reader, wordIds: number[]): boolean {
	if (wordIds.length === 0) return false;
	return (
		db
			.select({ id: question.id })
			.from(question)
			.where(inArray(question.wordId, wordIds))
			.limit(1)
			.get() !== undefined
	);
}

export const wordHasBeenAsked = (db: Db, wordId: number) => hasBeenAsked(db, [wordId]);

// ---- Switching on and off ----

/** A list that is off is never asked, whatever its words say. */
export function setListActive(db: Db, id: number, active: boolean): boolean {
	return db.update(wordList).set({ active }).where(eq(wordList.id, id)).run().changes > 0;
}

export function setWordActive(db: Db, listId: number, wordId: number, active: boolean): boolean {
	return (
		db
			.update(word)
			.set({ active })
			.where(and(eq(word.id, wordId), eq(word.listId, listId)))
			.run().changes > 0
	);
}

// ---- Custom lists ----

const cleanText = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ');

export interface ListInput {
	name: string;
	grade: number;
}

/** Checks a list's name and grade. Returns the tidied values or the problems found. */
export function checkList(input: {
	name: string;
	grade: string;
}): { ok: true; data: ListInput } | { ok: false; errors: FieldErrors } {
	const errors: FieldErrors = {};
	const name = cleanText(input.name);
	if (!name) errors.name = 'Please give the list a name.';
	else if (name.length > LIST_NAME_MAX) {
		errors.name = `A name can be at most ${LIST_NAME_MAX} characters.`;
	}
	const grade = Number(input.grade);
	if (!(GRADES as readonly number[]).includes(grade)) errors.grade = 'Please choose a grade.';
	return Object.keys(errors).length > 0
		? { ok: false, errors }
		: { ok: true, data: { name, grade } };
}

function nameTaken(db: Db, name: string, exceptId?: number): boolean {
	return db
		.select({ id: wordList.id, name: wordList.name })
		.from(wordList)
		.all()
		.some((list) => list.id !== exceptId && list.name.toLowerCase() === name.toLowerCase());
}

export type SaveListResult = { ok: true; id: number } | { ok: false; errors: FieldErrors };

const NAME_TAKEN = {
	ok: false,
	errors: { name: 'There is already a list with that name.' }
} as const;

export function createCustomList(db: Db, input: ListInput): SaveListResult {
	if (nameTaken(db, input.name)) return NAME_TAKEN;
	const row = db
		.insert(wordList)
		.values({ name: input.name, grade: input.grade, source: 'custom' })
		.returning()
		.get();
	return { ok: true, id: row.id };
}

const customList = (db: Reader, id: number) =>
	db
		.select()
		.from(wordList)
		.where(and(eq(wordList.id, id), eq(wordList.source, 'custom')))
		.get();

/** Renames a custom list or moves it to another grade. Null if it is not a custom list. */
export function updateCustomList(db: Db, id: number, input: ListInput): SaveListResult | null {
	if (!customList(db, id)) return null;
	if (nameTaken(db, input.name, id)) return NAME_TAKEN;
	db.update(wordList).set(input).where(eq(wordList.id, id)).run();
	return { ok: true, id };
}

/**
 * - deleted: the list and its words are gone.
 * - in-use: a child has been asked one of its words, so it can only be switched off.
 * - not-found: there is no custom list with that id (built-in lists cannot be deleted).
 */
export type DeleteResult = 'deleted' | 'in-use' | 'not-found';

export function deleteCustomList(db: Db, id: number): DeleteResult {
	return db.transaction((tx) => {
		if (!customList(tx, id)) return 'not-found';
		const ids = tx.select({ id: word.id }).from(word).where(eq(word.listId, id)).all();
		if (
			hasBeenAsked(
				tx,
				ids.map((row) => row.id)
			)
		) {
			return 'in-use';
		}
		tx.delete(wordList).where(eq(wordList.id, id)).run();
		return 'deleted';
	});
}

// ---- Custom words ----

/**
 * Splits pasted text into words: one per line, or separated by commas or semicolons.
 * Capitals are lowered and repeats dropped. Anything that is not a single word of
 * letters is returned in `rejected` so the parent can be told.
 */
export function parsePastedWords(text: string): { words: string[]; rejected: string[] } {
	const words: string[] = [];
	const rejected: string[] = [];
	for (const piece of text.normalize('NFKC').split(/[\n\r,;]+/)) {
		const candidate = piece.trim().toLowerCase();
		if (!candidate) continue;
		if (!/^[a-z]+$/.test(candidate) || candidate.length > WORD_MAX) {
			if (!rejected.includes(candidate)) rejected.push(candidate.slice(0, WORD_MAX + 10));
		} else if (!words.includes(candidate)) {
			words.push(candidate);
		}
	}
	return { words, rejected };
}

export interface WordInput {
	word: string;
	partOfSpeech: string;
	definition: string;
	sentence: string;
	/** As typed: words separated by commas. */
	synonyms: string;
}

const MESSAGES: Partial<Record<Rule, [field: keyof WordInput, message: string]>> = {
	'word-format': ['word', 'Use a single word, letters only.'],
	'part-of-speech': ['partOfSpeech', 'Please choose a kind of word.'],
	'definition-contains-word': ['definition', 'The meaning must not use the word itself.'],
	'definition-length': ['definition', 'Please give a meaning of 15 words or fewer.'],
	'sentence-word-count': [
		'sentence',
		'The sentence must use the word exactly once, spelled exactly as above.'
	],
	'sentence-punctuation': ['sentence', 'End the sentence with a full stop, ! or ?'],
	'synonym-is-word': ['synonyms', 'A word cannot mean the same as itself.'],
	'blocked-word': ['word', 'That is not a word for this app.']
};

/**
 * Checks one custom word against the same rules as the built-in lists (see
 * content/validate.ts), and returns it tidied or with one message per field.
 */
export function checkWord(
	input: WordInput
): { ok: true; data: ContentEntry } | { ok: false; errors: FieldErrors } {
	const entry: ContentEntry = {
		word: input.word.normalize('NFKC').trim().toLowerCase(),
		partOfSpeech: input.partOfSpeech as PartOfSpeech,
		definition: cleanText(input.definition),
		sentence: cleanText(input.sentence),
		synonyms: [
			...new Set(
				input.synonyms
					.normalize('NFKC')
					.split(/[,;\n]+/)
					.map((synonym) => synonym.trim().toLowerCase())
					.filter(Boolean)
			)
		]
	};

	const errors: FieldErrors = {};
	if (entry.word.length > WORD_MAX) errors.word = `A word can be at most ${WORD_MAX} letters.`;
	if (!entry.definition) errors.definition = 'Please give the meaning.';
	else if (entry.definition.length > TEXT_MAX) {
		errors.definition = `The meaning can be at most ${TEXT_MAX} characters.`;
	}
	if (!entry.sentence) errors.sentence = 'Please give a sentence that uses the word.';
	else if (entry.sentence.length > TEXT_MAX) {
		errors.sentence = `The sentence can be at most ${TEXT_MAX} characters.`;
	}
	if (entry.synonyms.some((synonym) => !/^[a-z]+$/.test(synonym) || synonym.length > WORD_MAX)) {
		errors.synonyms = 'List single words, separated by commas.';
	}
	if (entry.synonyms.length > 10) errors.synonyms = 'List at most 10 words.';
	if (!(PARTS_OF_SPEECH as readonly string[]).includes(entry.partOfSpeech)) {
		errors.partOfSpeech = 'Please choose a kind of word.';
	}

	// The rules shared with the built-in lists. Rules about a list as a whole (its size,
	// whether it has enough wrong choices) do not apply to a single word.
	for (const issue of validateContent([{ grade: 0, words: [entry] }])) {
		const mapped = MESSAGES[issue.rule];
		if (mapped) errors[mapped[0]] ??= mapped[1];
	}

	return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, data: entry };
}

const toRow = (entry: ContentEntry) => ({
	word: entry.word,
	partOfSpeech: entry.partOfSpeech,
	definition: entry.definition,
	sentence: entry.sentence,
	synonymsJson: entry.synonyms
});

/**
 * - ok: all the words were added.
 * - invalid: nothing was added. `errors[i]` holds the problems with the i-th word.
 * - not-found: there is no custom list with that id.
 */
export type AddWordsResult =
	| { status: 'ok'; added: number }
	| { status: 'invalid'; errors: FieldErrors[] }
	| { status: 'not-found' };

/** Adds several words to a custom list. All of them are added, or none. */
export function addWords(db: Db, listId: number, inputs: WordInput[]): AddWordsResult {
	if (!customList(db, listId)) return { status: 'not-found' };

	const existing = new Set(
		db
			.select({ word: word.word })
			.from(word)
			.where(eq(word.listId, listId))
			.all()
			.map((row) => row.word)
	);

	const entries: ContentEntry[] = [];
	const errors: FieldErrors[] = [];
	for (const input of inputs) {
		const checked = checkWord(input);
		const problems: FieldErrors = checked.ok ? {} : checked.errors;
		const name = input.word.normalize('NFKC').trim().toLowerCase();
		if (existing.has(name)) problems.word ??= 'This word is already in the list.';
		else if (entries.some((entry) => entry.word === name)) {
			problems.word ??= 'This word is here twice.';
		}
		if (checked.ok) entries.push(checked.data);
		errors.push(problems);
	}
	if (errors.some((problems) => Object.keys(problems).length > 0)) {
		return { status: 'invalid', errors };
	}

	db.transaction((tx) => {
		for (const entry of entries) {
			tx.insert(word)
				.values({ listId, ...toRow(entry) })
				.run();
		}
	});
	return { status: 'ok', added: entries.length };
}

export type UpdateWordResult =
	{ status: 'ok' } | { status: 'invalid'; errors: FieldErrors } | { status: 'not-found' };

/**
 * Changes a word in a custom list. Once a child has been asked the word its spelling is
 * fixed, so that their history keeps meaning what it meant; the rest can still be improved.
 */
export function updateWord(
	db: Db,
	listId: number,
	wordId: number,
	input: WordInput
): UpdateWordResult {
	if (!customList(db, listId)) return { status: 'not-found' };
	const current = getWord(db, listId, wordId);
	if (!current) return { status: 'not-found' };

	const checked = checkWord(input);
	if (!checked.ok) return { status: 'invalid', errors: checked.errors };
	const entry = checked.data;

	if (entry.word !== current.word) {
		if (hasBeenAsked(db, [wordId])) {
			return {
				status: 'invalid',
				errors: { word: 'This word has been practiced, so its spelling cannot change.' }
			};
		}
		const clash = db
			.select({ id: word.id })
			.from(word)
			.where(and(eq(word.listId, listId), eq(word.word, entry.word)))
			.get();
		if (clash) return { status: 'invalid', errors: { word: 'This word is already in the list.' } };
	}

	db.update(word).set(toRow(entry)).where(eq(word.id, wordId)).run();
	return { status: 'ok' };
}

/** Removes a word from a custom list, unless a child has been asked it. */
export function deleteWord(db: Db, listId: number, wordId: number): DeleteResult {
	if (!customList(db, listId) || !getWord(db, listId, wordId)) return 'not-found';
	if (hasBeenAsked(db, [wordId])) return 'in-use';
	db.delete(word).where(eq(word.id, wordId)).run();
	return 'deleted';
}

/** The names of other lists that already hold each of these words. */
export function alsoListedIn(db: Db, words: string[], exceptListId: number): Map<string, string> {
	if (words.length === 0) return new Map();
	const rows = db
		.select({ word: word.word, list: wordList.name, listId: wordList.id })
		.from(word)
		.innerJoin(wordList, eq(wordList.id, word.listId))
		.where(inArray(word.word, words))
		.all();
	return new Map(
		rows.filter((row) => row.listId !== exceptListId).map((row) => [row.word, row.list])
	);
}
