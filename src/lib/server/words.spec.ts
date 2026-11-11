import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './children.ts';
import type { Db } from './db/client.ts';
import { practiceSession, question, word, wordList } from './db/schema.ts';
import { startPractice } from './practice.ts';
import { createTestDb } from './test-db.ts';
import { buildFixture, CHICAGO, NOW, type Fixture } from './test-fixture.ts';
import {
	addWords,
	alsoListedIn,
	checkList,
	checkWord,
	createCustomList,
	deleteCustomList,
	deleteWord,
	getWord,
	getWordList,
	listWordLists,
	parsePastedWords,
	setListActive,
	setWordActive,
	updateCustomList,
	updateWord,
	type WordInput
} from './words.ts';

// The fixture has two built-in lists: grade 3 (w1 to w11, w11 switched off) and grade 4
// (v1 to v5). Sam has been asked w1 to w5.

let db: Db;
let close: () => void;
let fixture: Fixture;

beforeEach(() => {
	({ db, close } = createTestDb());
	fixture = buildFixture(db);
});
afterEach(() => close());

const brave: WordInput = {
	word: 'brave',
	partOfSpeech: 'adjective',
	definition: 'ready to face danger',
	sentence: 'The brave girl climbed the tall tree.',
	synonyms: 'bold, fearless'
};
const input = (changes: Partial<WordInput> = {}): WordInput => ({ ...brave, ...changes });

function newList(name = 'School words', grade = 3): number {
	const result = createCustomList(db, { name, grade });
	if (!result.ok) throw new Error('could not create list');
	return result.id;
}

const builtin = (grade: number) =>
	db.select().from(wordList).where(eq(wordList.grade, grade)).all()[0].id;

describe('listWordLists', () => {
	it('lists built-in lists by grade, then custom ones, with counts', () => {
		const mine = newList();
		addWords(db, mine, [brave]);
		expect(listWordLists(db)).toEqual([
			expect.objectContaining({ name: 'Grade 3', source: 'builtin', words: 11, activeWords: 10 }),
			expect.objectContaining({ name: 'Grade 4', source: 'builtin', words: 5, activeWords: 5 }),
			{
				id: mine,
				name: 'School words',
				grade: 3,
				source: 'custom',
				active: true,
				words: 1,
				activeWords: 1
			}
		]);
	});

	it('counts an empty list as having no words', () => {
		const mine = newList();
		expect(getWordList(db, mine)).toMatchObject({ words: 0, activeWords: 0, entries: [] });
	});

	it('gives the words of a list in alphabetical order', () => {
		const mine = newList();
		addWords(db, mine, [
			input({ word: 'zebra', sentence: 'A zebra ran.', definition: 'a striped animal' }),
			brave
		]);
		expect(getWordList(db, mine)!.entries.map((entry) => entry.word)).toEqual(['brave', 'zebra']);
		expect(getWordList(db, 99_999)).toBeNull();
	});
});

describe('switching on and off', () => {
	it('switches a word off and on, built-in or not', () => {
		const list = builtin(3);
		expect(setWordActive(db, list, fixture.words.w1, false)).toBe(true);
		expect(getWord(db, list, fixture.words.w1)!.active).toBe(false);
		expect(setWordActive(db, list, fixture.words.w1, true)).toBe(true);
		expect(getWord(db, list, fixture.words.w1)!.active).toBe(true);
	});

	it('only switches a word through the list it belongs to', () => {
		expect(setWordActive(db, builtin(4), fixture.words.w1, false)).toBe(false);
		expect(getWord(db, builtin(3), fixture.words.w1)!.active).toBe(true);
	});

	it('switches a whole list', () => {
		expect(setListActive(db, builtin(4), false)).toBe(true);
		expect(listWordLists(db)[1]).toMatchObject({ name: 'Grade 4', active: false });
		expect(setListActive(db, 99_999, false)).toBe(false);
	});

	it('a word that is switched off is not given as a new word', () => {
		// Leave Zed only two grade 4 words to be given.
		const list = builtin(4);
		for (const name of ['v1', 'v2', 'v3']) setWordActive(db, list, fixture.words[name], false);
		const zed = { id: fixture.mia, grade: 4, settings: DEFAULT_SETTINGS };
		expect(startPractice(db, zed, { now: NOW, timeZone: CHICAGO, rng: Math.random })).toBe(
			'started'
		);
		const plan = db
			.select()
			.from(practiceSession)
			.where(eq(practiceSession.childId, fixture.mia))
			.all()
			.at(-1)!.planJson;
		const asked = new Set(plan.map((item) => item.wordId));
		expect(asked.has(fixture.words.v1)).toBe(false);
		expect(asked.has(fixture.words.v4)).toBe(true);
		expect(asked.has(fixture.words.v5)).toBe(true);
	});
});

describe('checkList', () => {
	it('tidies the name and reads the grade', () => {
		expect(checkList({ name: '  Week   12 ', grade: '4' })).toEqual({
			ok: true,
			data: { name: 'Week 12', grade: 4 }
		});
	});

	it('needs a name of sensible length and a grade that exists', () => {
		expect(checkList({ name: ' ', grade: '3' })).toMatchObject({
			ok: false,
			errors: { name: 'Please give the list a name.' }
		});
		expect(checkList({ name: 'x'.repeat(41), grade: '3' })).toMatchObject({ ok: false });
		expect(checkList({ name: 'Week 12', grade: '13' })).toMatchObject({
			ok: false,
			errors: { grade: 'Please choose a grade.' }
		});
		expect(checkList({ name: 'Week 12', grade: '' })).toMatchObject({ ok: false });
	});
});

describe('custom lists', () => {
	it('cannot share a name with another list, whatever the capitals', () => {
		newList('School words');
		expect(createCustomList(db, { name: 'school WORDS', grade: 4 })).toMatchObject({ ok: false });
		expect(createCustomList(db, { name: 'grade 3', grade: 3 })).toMatchObject({ ok: false });
	});

	it('can be renamed and moved to another grade', () => {
		const mine = newList();
		expect(updateCustomList(db, mine, { name: 'Week 12', grade: 4 })).toEqual({
			ok: true,
			id: mine
		});
		expect(getWordList(db, mine)).toMatchObject({ name: 'Week 12', grade: 4 });
		// Keeping its own name is not a clash.
		expect(updateCustomList(db, mine, { name: 'week 12', grade: 4 })).toMatchObject({ ok: true });
		expect(updateCustomList(db, mine, { name: 'Grade 4', grade: 4 })).toMatchObject({ ok: false });
	});

	it('built-in lists cannot be renamed or deleted', () => {
		expect(updateCustomList(db, builtin(3), { name: 'Mine now', grade: 3 })).toBeNull();
		expect(deleteCustomList(db, builtin(4))).toBe('not-found');
		expect(listWordLists(db).map((list) => list.name)).toEqual(['Grade 3', 'Grade 4']);
	});

	it('can be deleted, with its words, until one has been practiced', () => {
		const mine = newList();
		addWords(db, mine, [brave]);
		const other = newList('Other');
		addWords(db, other, [brave]);
		const asked = getWordList(db, other)!.entries[0].id;
		db.insert(question)
			.values({
				practiceSessionId: fixture.sessions[0],
				wordId: asked,
				type: 'word_to_def',
				choicesJson: [],
				correctChoice: 'x',
				servedAt: NOW
			})
			.run();

		expect(deleteCustomList(db, mine)).toBe('deleted');
		expect(getWordList(db, mine)).toBeNull();
		expect(deleteCustomList(db, other)).toBe('in-use');
		expect(getWordList(db, other)!.entries).toHaveLength(1);
		expect(deleteCustomList(db, 99_999)).toBe('not-found');
	});
});

describe('parsePastedWords', () => {
	it('takes one word per line or separated by commas', () => {
		expect(parsePastedWords('brave\ncurious\r\n  gentle  \n\n')).toEqual({
			words: ['brave', 'curious', 'gentle'],
			rejected: []
		});
		expect(parsePastedWords('brave, curious; gentle').words).toEqual([
			'brave',
			'curious',
			'gentle'
		]);
	});

	it('lowers capitals and drops repeats', () => {
		expect(parsePastedWords('Brave\nBRAVE\nbrave').words).toEqual(['brave']);
	});

	it('sets aside anything that is not one word of letters', () => {
		expect(parsePastedWords("ice cream\ndon't\nr2d2\nbrave\n<b>hi</b>")).toEqual({
			words: ['brave'],
			rejected: ['ice cream', "don't", 'r2d2', '<b>hi</b>']
		});
		expect(parsePastedWords('a'.repeat(31)).words).toEqual([]);
	});
});

describe('checkWord', () => {
	it('accepts a good word and tidies it', () => {
		expect(
			checkWord(
				input({
					word: ' Brave ',
					definition: ' ready  to face danger ',
					synonyms: 'Bold,, bold ,fearless'
				})
			)
		).toEqual({
			ok: true,
			data: {
				word: 'brave',
				partOfSpeech: 'adjective',
				definition: 'ready to face danger',
				sentence: 'The brave girl climbed the tall tree.',
				synonyms: ['bold', 'fearless']
			}
		});
		expect(checkWord(input({ synonyms: '' }))).toMatchObject({ ok: true, data: { synonyms: [] } });
	});

	const problems = (changes: Partial<WordInput>) => {
		const result = checkWord(input(changes));
		return result.ok ? {} : result.errors;
	};

	it('wants a single word of letters', () => {
		expect(problems({ word: 'ice cream' }).word).toBe('Use a single word, letters only.');
		expect(problems({ word: '' }).word).toBeDefined();
		expect(problems({ word: 'a'.repeat(31) }).word).toBeDefined();
	});

	it('wants a known kind of word', () => {
		expect(problems({ partOfSpeech: '' }).partOfSpeech).toBe('Please choose a kind of word.');
		expect(problems({ partOfSpeech: 'pronoun' }).partOfSpeech).toBeDefined();
	});

	it('wants a short meaning that does not give the word away', () => {
		expect(problems({ definition: '' }).definition).toBe('Please give the meaning.');
		expect(problems({ definition: 'being brave when scared' }).definition).toBe(
			'The meaning must not use the word itself.'
		);
		expect(
			problems({
				definition:
					'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'
			}).definition
		).toBe('Please give a meaning of 15 words or fewer.');
		expect(problems({ definition: 'x'.repeat(201) }).definition).toBeDefined();
	});

	it('wants a sentence that uses the word exactly once and ends properly', () => {
		expect(problems({ sentence: '' }).sentence).toBe('Please give a sentence that uses the word.');
		expect(problems({ sentence: 'She climbed the tree.' }).sentence).toMatch(/exactly once/);
		// "bravely" is not "brave".
		expect(problems({ sentence: 'She bravely climbed the tree.' }).sentence).toMatch(
			/exactly once/
		);
		expect(problems({ sentence: 'A brave girl is a brave friend.' }).sentence).toMatch(
			/exactly once/
		);
		expect(problems({ sentence: 'The brave girl climbed' }).sentence).toMatch(/End the sentence/);
		expect(problems({ sentence: 'Brave girls climb!' })).toEqual({});
	});

	it('wants same-meaning words to be single words, and not the word itself', () => {
		expect(problems({ synonyms: 'very bold' }).synonyms).toBeDefined();
		expect(problems({ synonyms: 'brave' }).synonyms).toBe('A word cannot mean the same as itself.');
	});

	it('refuses rude words', () => {
		expect(problems({ word: 'damn', sentence: 'He said damn.' }).word).toBe(
			'That is not a word for this app.'
		);
		expect(problems({ sentence: 'The brave girl said damn.' })).not.toEqual({});
	});

	it('reports every field with a problem at once', () => {
		expect(
			Object.keys(problems({ word: 'two words', definition: '', sentence: '' })).sort()
		).toEqual(['definition', 'sentence', 'word']);
	});
});

describe('addWords', () => {
	it('adds words to a custom list, switched on', () => {
		const mine = newList();
		expect(addWords(db, mine, [brave])).toEqual({ status: 'ok', added: 1 });
		expect(getWordList(db, mine)!.entries).toEqual([
			{
				id: expect.any(Number),
				word: 'brave',
				partOfSpeech: 'adjective',
				definition: 'ready to face danger',
				sentence: 'The brave girl climbed the tall tree.',
				synonyms: ['bold', 'fearless'],
				active: true
			}
		]);
	});

	it('adds all or nothing, and says which entries have problems', () => {
		const mine = newList();
		const result = addWords(db, mine, [
			brave,
			input({ word: 'gentle', sentence: 'No such word.' })
		]);
		expect(result).toEqual({
			status: 'invalid',
			errors: [{}, { sentence: expect.stringMatching(/exactly once/) }]
		});
		expect(getWordList(db, mine)!.entries).toEqual([]);
	});

	it('refuses a word that is already in the list, or given twice', () => {
		const mine = newList();
		addWords(db, mine, [brave]);
		expect(addWords(db, mine, [input({ word: 'Brave' })])).toEqual({
			status: 'invalid',
			errors: [{ word: 'This word is already in the list.' }]
		});

		const other = newList('Other');
		expect(addWords(db, other, [brave, brave])).toEqual({
			status: 'invalid',
			errors: [{}, { word: 'This word is here twice.' }]
		});
	});

	it('allows a word that is in a different list', () => {
		db.insert(word)
			.values({
				listId: builtin(3),
				word: 'brave',
				partOfSpeech: 'adjective',
				definition: 'not afraid',
				sentence: 'Be brave.'
			})
			.run();
		const mine = newList();
		expect(addWords(db, mine, [brave])).toMatchObject({ status: 'ok' });
		expect(alsoListedIn(db, ['brave', 'gentle'], mine)).toEqual(new Map([['brave', 'Grade 3']]));
	});

	it('never adds to a built-in list', () => {
		expect(addWords(db, builtin(3), [brave])).toEqual({ status: 'not-found' });
		expect(getWordList(db, builtin(3))!.entries).toHaveLength(11);
	});
});

describe('updateWord and deleteWord', () => {
	let mine: number;
	let braveId: number;

	beforeEach(() => {
		mine = newList();
		addWords(db, mine, [brave]);
		braveId = getWordList(db, mine)!.entries[0].id;
	});

	const practice = () =>
		db
			.insert(question)
			.values({
				practiceSessionId: fixture.sessions[0],
				wordId: braveId,
				type: 'word_to_def',
				choicesJson: [],
				correctChoice: 'x',
				servedAt: NOW
			})
			.run();

	it('changes a custom word', () => {
		expect(
			updateWord(db, mine, braveId, input({ definition: 'not afraid', synonyms: '' }))
		).toEqual({ status: 'ok' });
		expect(getWord(db, mine, braveId)).toMatchObject({ definition: 'not afraid', synonyms: [] });
	});

	it('checks the new values', () => {
		expect(updateWord(db, mine, braveId, input({ definition: '' }))).toMatchObject({
			status: 'invalid'
		});
		expect(getWord(db, mine, braveId)!.definition).toBe('ready to face danger');
	});

	it('can respell a word that has not been practiced, but not onto another word', () => {
		addWords(db, mine, [input({ word: 'bold', sentence: 'A bold move.', synonyms: '' })]);
		const respelled = input({ word: 'braver', sentence: 'She was braver than him.' });
		expect(updateWord(db, mine, braveId, respelled)).toEqual({ status: 'ok' });
		expect(
			updateWord(db, mine, braveId, input({ word: 'bold', sentence: 'A bold move.', synonyms: '' }))
		).toEqual({ status: 'invalid', errors: { word: 'This word is already in the list.' } });
	});

	it('keeps the spelling of a practiced word, but lets the rest improve', () => {
		practice();
		expect(
			updateWord(db, mine, braveId, input({ word: 'braver', sentence: 'She was braver.' }))
		).toMatchObject({ status: 'invalid', errors: { word: expect.stringMatching(/practiced/) } });
		expect(updateWord(db, mine, braveId, input({ definition: 'not afraid' }))).toEqual({
			status: 'ok'
		});
	});

	it('never changes or removes a built-in word', () => {
		const list = builtin(3);
		expect(updateWord(db, list, fixture.words.w9, brave)).toEqual({ status: 'not-found' });
		expect(deleteWord(db, list, fixture.words.w9)).toBe('not-found');
		expect(getWord(db, list, fixture.words.w9)!.word).toBe('w9');
	});

	it('does not reach a word through the wrong list', () => {
		const other = newList('Other');
		expect(updateWord(db, other, braveId, brave)).toEqual({ status: 'not-found' });
		expect(deleteWord(db, other, braveId)).toBe('not-found');
	});

	it('removes a word until it has been practiced', () => {
		addWords(db, mine, [input({ word: 'bold', sentence: 'A bold move.', synonyms: '' })]);
		const boldId = getWordList(db, mine)!.entries[0].id;
		practice();
		expect(deleteWord(db, mine, boldId)).toBe('deleted');
		expect(deleteWord(db, mine, braveId)).toBe('in-use');
		expect(getWordList(db, mine)!.entries.map((entry) => entry.word)).toEqual(['brave']);
	});
});

describe('new words in practice', () => {
	it("come from the parent's own list before the built-in one", () => {
		const mine = newList('School words', 4);
		addWords(db, mine, [
			brave,
			input({ word: 'gentle', definition: 'soft and kind', sentence: 'Be gentle.', synonyms: '' })
		]);
		const ids = getWordList(db, mine)!.entries.map((entry) => entry.id);

		// Mia moves to grade 4, where there are five built-in words and these two. With four
		// new words a session, both of the parent's must be among them every time.
		const mia = { id: fixture.mia, grade: 4, settings: DEFAULT_SETTINGS };
		for (let seed = 1; seed <= 20; seed++) {
			let state = seed;
			const rng = () => {
				state = (state * 1664525 + 1013904223) % 4294967296;
				return state / 4294967296;
			};
			db.delete(practiceSession).where(eq(practiceSession.childId, mia.id)).run();
			expect(startPractice(db, mia, { now: NOW, timeZone: CHICAGO, rng })).toBe('started');
			const plan = db
				.select()
				.from(practiceSession)
				.where(eq(practiceSession.childId, mia.id))
				.get()!.planJson;
			const asked = new Set(plan.map((item) => item.wordId));
			expect(
				ids.every((id) => asked.has(id)),
				`seed ${seed}`
			).toBe(true);
		}
	});

	it('skips a custom list that is switched off', () => {
		const mine = newList('School words', 4);
		addWords(db, mine, [brave]);
		setListActive(db, mine, false);
		const braveId = db.select().from(word).where(eq(word.word, 'brave')).get()!.id;

		const mia = { id: fixture.mia, grade: 4, settings: DEFAULT_SETTINGS };
		startPractice(db, mia, { now: NOW, timeZone: CHICAGO, rng: Math.random });
		const plan = db
			.select()
			.from(practiceSession)
			.where(eq(practiceSession.childId, mia.id))
			.all()
			.at(-1)!.planJson;
		expect(plan.some((item) => item.wordId === braveId)).toBe(false);
	});
});
