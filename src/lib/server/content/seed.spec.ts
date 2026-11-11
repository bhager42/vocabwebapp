import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/client.ts';
import { child, word, wordList, wordProgress } from '../db/schema.ts';
import { loadContent } from './load.ts';
import { seedBuiltinWords } from './seed.ts';
import type { ContentEntry, GradeContent } from './validate.ts';

const entry = (name: string, overrides: Partial<ContentEntry> = {}): ContentEntry => ({
	word: name,
	partOfSpeech: 'noun',
	definition: `what ${name} means`,
	sentence: `I saw a ${name} today.`,
	synonyms: [],
	...overrides
});

const content = (): GradeContent[] => [
	{ grade: 3, words: [entry('apple'), entry('boat', { synonyms: ['ship'] })] },
	{ grade: 4, words: [entry('cloud')] }
];

let dir: string;
let db: Db;

const rowCounts = () => ({
	lists: db.select().from(wordList).all().length,
	words: db.select().from(word).all().length
});

const wordRow = (name: string) => db.select().from(word).where(eq(word.word, name)).get()!;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'vocab-seed-'));
	db = openDatabase(path.join(dir, 'test.db'), path.resolve('drizzle'));
});

afterEach(() => {
	db.$client.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('seedBuiltinWords', () => {
	it('creates one built-in list per grade and inserts every word', () => {
		const result = seedBuiltinWords(db, content());

		expect(result).toEqual({
			listsCreated: 2,
			inserted: 3,
			updated: 0,
			unchanged: 0,
			deactivated: 0
		});
		expect(db.select().from(wordList).all()).toMatchObject([
			{ name: 'Grade 3', grade: 3, source: 'builtin', active: true },
			{ name: 'Grade 4', grade: 4, source: 'builtin', active: true }
		]);
		expect(wordRow('boat')).toMatchObject({
			partOfSpeech: 'noun',
			definition: 'what boat means',
			sentence: 'I saw a boat today.',
			synonymsJson: ['ship'],
			active: true
		});
	});

	it('is idempotent: seeding twice leaves the same rows', () => {
		seedBuiltinWords(db, content());
		const before = rowCounts();
		const idsBefore = db.select({ id: word.id, word: word.word }).from(word).all();

		const result = seedBuiltinWords(db, content());

		expect(result).toEqual({
			listsCreated: 0,
			inserted: 0,
			updated: 0,
			unchanged: 3,
			deactivated: 0
		});
		expect(rowCounts()).toEqual(before);
		expect(db.select({ id: word.id, word: word.word }).from(word).all()).toEqual(idsBefore);
	});

	it('updates changed text in place, keeping the word id and the child progress', () => {
		seedBuiltinWords(db, content());
		const apple = wordRow('apple');
		const kid = db
			.insert(child)
			.values({ name: 'Sam', nameNormalized: 'sam', createdAt: new Date() })
			.returning()
			.get();
		db.insert(wordProgress)
			.values({
				childId: kid.id,
				wordId: apple.id,
				box: 3,
				dueAt: new Date(),
				firstSeenAt: new Date()
			})
			.run();

		const edited = content();
		edited[0].words[0] = entry('apple', { definition: 'a round fruit', synonyms: ['fruit'] });
		const result = seedBuiltinWords(db, edited);

		expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 2 });
		expect(wordRow('apple')).toMatchObject({
			id: apple.id,
			definition: 'a round fruit',
			synonymsJson: ['fruit']
		});
		expect(db.select().from(wordProgress).all()).toMatchObject([
			{ childId: kid.id, wordId: apple.id, box: 3 }
		]);
	});

	it('does not re-enable a word the parent has disabled', () => {
		seedBuiltinWords(db, content());
		db.update(word).set({ active: false }).where(eq(word.word, 'apple')).run();

		const edited = content();
		edited[0].words[0] = entry('apple', { definition: 'a round fruit' });
		seedBuiltinWords(db, edited);

		expect(wordRow('apple')).toMatchObject({ definition: 'a round fruit', active: false });
	});

	it('deactivates, but keeps, a word that was removed from the content', () => {
		seedBuiltinWords(db, content());

		const trimmed = content();
		trimmed[0].words.pop(); // remove "boat"
		const result = seedBuiltinWords(db, trimmed);

		expect(result).toMatchObject({ deactivated: 1, unchanged: 2 });
		expect(wordRow('boat').active).toBe(false);
		expect(rowCounts().words).toBe(3);

		// And a further run has nothing left to do.
		expect(seedBuiltinWords(db, trimmed)).toMatchObject({ deactivated: 0, updated: 0 });
	});

	it('leaves custom lists alone', () => {
		const custom = db
			.insert(wordList)
			.values({ name: 'School week 1', grade: 3, source: 'custom' })
			.returning()
			.get();
		db.insert(word)
			.values({
				listId: custom.id,
				word: 'apple',
				partOfSpeech: 'noun',
				definition: 'from school',
				sentence: 'An apple a day.'
			})
			.run();

		seedBuiltinWords(db, content());

		const customWords = db.select().from(word).where(eq(word.listId, custom.id)).all();
		expect(customWords).toMatchObject([{ word: 'apple', definition: 'from school', active: true }]);
		expect(rowCounts()).toEqual({ lists: 3, words: 4 });
	});

	it('seeds the shipped content: 120 words a grade, the same after a second run', () => {
		const shipped = loadContent(path.resolve('content'));
		const total = shipped.length * 120;

		expect(seedBuiltinWords(db, shipped)).toMatchObject({
			listsCreated: shipped.length,
			inserted: total
		});
		expect(seedBuiltinWords(db, shipped)).toMatchObject({
			listsCreated: 0,
			inserted: 0,
			updated: 0,
			unchanged: total
		});
		expect(rowCounts()).toEqual({ lists: shipped.length, words: total });
	});

	it('adds a new grade to a database in use without touching anything already there', () => {
		seedBuiltinWords(db, content());
		const kid = db
			.insert(child)
			.values({ name: 'Sam', nameNormalized: 'sam', createdAt: new Date() })
			.returning()
			.get();
		const apple = wordRow('apple');
		db.insert(wordProgress)
			.values({
				childId: kid.id,
				wordId: apple.id,
				box: 4,
				dueAt: new Date(),
				firstSeenAt: new Date()
			})
			.run();
		db.update(word).set({ active: false }).where(eq(word.word, 'boat')).run();
		db.update(wordList).set({ active: false }).where(eq(wordList.grade, 4)).run();
		const wordsBefore = db.select().from(word).all();
		const listsBefore = db.select().from(wordList).all();
		const progressBefore = db.select().from(wordProgress).all();

		const result = seedBuiltinWords(db, [
			...content(),
			{ grade: 5, words: [entry('desk'), entry('eagle')] }
		]);

		expect(result).toEqual({
			listsCreated: 1,
			inserted: 2,
			updated: 0,
			unchanged: 3,
			deactivated: 0
		});
		expect(db.select().from(word).all().slice(0, wordsBefore.length)).toEqual(wordsBefore);
		expect(db.select().from(wordList).all().slice(0, listsBefore.length)).toEqual(listsBefore);
		expect(db.select().from(wordProgress).all()).toEqual(progressBefore);
		expect(db.select().from(wordList).where(eq(wordList.grade, 5)).get()).toMatchObject({
			name: 'Grade 5',
			source: 'builtin',
			active: true
		});
	});
});
