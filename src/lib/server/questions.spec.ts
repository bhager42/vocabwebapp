import { describe, expect, it } from 'vitest';
import {
	BLANK,
	blankSentence,
	buildQuestion,
	composePlan,
	isCorrect,
	pickDistractors,
	publicQuestion,
	shuffle,
	typeForBox,
	withRetry,
	type PlanInput,
	type PlanItem,
	type Rng,
	type WordInfo
} from './questions.ts';

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1): Rng {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

let nextId = 1;
const make = (name: string, overrides: Partial<WordInfo> = {}): WordInfo => ({
	id: nextId++,
	listId: 1,
	grade: 3,
	word: name,
	partOfSpeech: 'adjective',
	definition: `meaning of ${name}`,
	sentence: `It was a ${name} day.`,
	synonyms: [],
	...overrides
});

const names = (words: WordInfo[]) => words.map((entry) => entry.word).sort();

describe('typeForBox', () => {
	it('asks harder kinds of question as the box goes up', () => {
		expect([1, 2, 3, 4, 5].map((box) => typeForBox(box, true))).toEqual([
			'word_to_def',
			'word_to_def',
			'def_to_word',
			'cloze',
			'spell'
		]);
	});

	it('uses fill-in-the-blank for box 5 when spelling is turned off', () => {
		expect(typeForBox(5, false)).toBe('cloze');
		expect(typeForBox(4, false)).toBe('cloze');
	});
});

describe('blankSentence', () => {
	it('takes the word out of its sentence', () => {
		expect(blankSentence('The timid rabbit hid.', 'timid')).toBe(`The ${BLANK} rabbit hid.`);
	});

	it('finds the word when it starts the sentence with a capital', () => {
		expect(blankSentence('Gently pet the kitten.', 'gently')).toBe(`${BLANK} pet the kitten.`);
	});

	it('leaves longer words that merely contain it alone', () => {
		expect(blankSentence('A rare bird is rarely seen.', 'rare')).toBe(
			`A ${BLANK} bird is rarely seen.`
		);
	});
});

describe('shuffle', () => {
	it('keeps every item and does not change the original', () => {
		const items = [1, 2, 3, 4, 5, 6];
		const result = shuffle(items, seeded());

		expect([...result].sort()).toEqual(items);
		expect(items).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('gives different orders for different random numbers', () => {
		const items = [1, 2, 3, 4, 5, 6, 7, 8];
		expect(shuffle(items, seeded(1))).not.toEqual(shuffle(items, seeded(2)));
	});
});

describe('pickDistractors', () => {
	const target = make('enormous', { synonyms: ['huge', 'giant'] });

	it('picks three words from the same list with the same part of speech', () => {
		const pool = [
			target,
			make('timid'),
			make('fragile'),
			make('weary'),
			make('honest'),
			make('wander', { partOfSpeech: 'verb' }),
			make('abundant', { listId: 2, grade: 4 })
		];

		for (let seed = 1; seed <= 25; seed++) {
			const picked = pickDistractors(target, pool, seeded(seed));
			expect(picked).toHaveLength(3);
			for (const entry of picked) {
				expect(entry.partOfSpeech).toBe('adjective');
				expect(entry.listId).toBe(1);
				expect(entry.word).not.toBe('enormous');
			}
			expect(new Set(picked).size).toBe(3);
		}
	});

	it('never picks a synonym, whichever of the two words lists the other', () => {
		const pool = [
			target,
			make('huge'), // the target names it as a synonym
			make('vast', { synonyms: ['enormous'] }), // it names the target
			make('timid'),
			make('fragile'),
			make('weary')
		];

		for (let seed = 1; seed <= 25; seed++) {
			expect(names(pickDistractors(target, pool, seeded(seed)))).toEqual([
				'fragile',
				'timid',
				'weary'
			]);
		}
	});

	it('varies the choice from one question to the next', () => {
		const pool = [target, ...'abcdefghij'.split('').map((letter) => make(`word${letter}`))];
		const picks = new Set(
			Array.from({ length: 20 }, (_, seed) =>
				names(pickDistractors(target, pool, seeded(seed + 1))).join()
			)
		);
		expect(picks.size).toBeGreaterThan(5);
	});

	it('widens to the same grade, then other grades, when the list is too small', () => {
		const pool = [
			target,
			make('timid'),
			make('careful', { listId: 2 }), // another list, same grade
			make('ancient', { listId: 3, grade: 4 }),
			make('wander', { partOfSpeech: 'verb' })
		];

		expect(names(pickDistractors(target, pool, seeded()))).toEqual(['ancient', 'careful', 'timid']);
	});

	it('uses another part of speech only when nothing else is left', () => {
		const pool = [target, make('timid'), make('fragile'), make('wander', { partOfSpeech: 'verb' })];

		expect(names(pickDistractors(target, pool, seeded()))).toEqual(['fragile', 'timid', 'wander']);
	});

	it('returns fewer than three rather than a synonym or the word itself', () => {
		const pool = [target, make('huge'), make('timid')];

		expect(names(pickDistractors(target, pool, seeded()))).toEqual(['timid']);
	});

	it('never shows two choices that look the same', () => {
		const pool = [
			target,
			make('timid', { definition: 'shy' }),
			make('bashful', { definition: 'shy' }),
			make('weary'),
			make('honest')
		];

		for (let seed = 1; seed <= 25; seed++) {
			const shown = pickDistractors(target, pool, seeded(seed), (entry) => entry.definition).map(
				(entry) => entry.definition
			);
			expect(new Set(shown).size).toBe(3);
		}
	});
});

describe('buildQuestion', () => {
	const target = make('timid', { definition: 'shy and easily scared' });
	const pool = [target, make('fragile'), make('weary'), make('honest'), make('eager')];

	it('offers four definitions for "what does this word mean?"', () => {
		const built = buildQuestion(target, 'word_to_def', pool, seeded());

		expect(built.choices).toHaveLength(4);
		expect(built.correctChoice).toBe('shy and easily scared');
		expect(built.choices).toContain('shy and easily scared');
		expect(
			built.choices.every(
				(choice) => choice.startsWith('meaning of') || choice === built.correctChoice
			)
		).toBe(true);
	});

	it.each(['def_to_word', 'cloze'] as const)('offers four words for %s', (type) => {
		const built = buildQuestion(target, type, pool, seeded());

		expect(built.choices).toHaveLength(4);
		expect(built.correctChoice).toBe('timid');
		expect(built.choices).toContain('timid');
	});

	it('has no choices for a spelling question', () => {
		expect(buildQuestion(target, 'spell', pool, seeded())).toEqual({
			type: 'spell',
			choices: [],
			correctChoice: 'timid'
		});
	});

	it('puts the right answer in a different place from one question to the next', () => {
		const places = new Set(
			Array.from({ length: 40 }, (_, seed) => {
				const built = buildQuestion(target, 'def_to_word', pool, seeded(seed + 1));
				return built.choices.indexOf(built.correctChoice);
			})
		);
		expect(places).toEqual(new Set([0, 1, 2, 3]));
	});
});

describe('publicQuestion: what is sent to the browser', () => {
	const target = make('timid', {
		definition: 'shy and easily scared',
		sentence: 'The timid rabbit hid under the bush.'
	});

	it('never includes which choice is right', () => {
		for (const type of ['word_to_def', 'def_to_word', 'cloze', 'spell'] as const) {
			const sent = publicQuestion(7, type, target, ['a', 'b', 'c', 'd']);
			expect(Object.keys(sent).join()).not.toMatch(/correct|answer/i);
		}
	});

	it('shows the word, but not its definition, for "what does this word mean?"', () => {
		const sent = publicQuestion(7, 'word_to_def', target, ['a', 'b', 'c', 'd']);

		expect(sent).toEqual({
			id: 7,
			type: 'word_to_def',
			word: 'timid',
			choices: ['a', 'b', 'c', 'd']
		});
	});

	it('shows the definition, but not the word, for "which word means this?"', () => {
		const sent = publicQuestion(7, 'def_to_word', target, ['a', 'b', 'c', 'd']);

		expect(sent).toEqual({
			id: 7,
			type: 'def_to_word',
			definition: 'shy and easily scared',
			choices: ['a', 'b', 'c', 'd']
		});
	});

	it('blanks the word out of the sentence for fill-in-the-blank', () => {
		const sent = publicQuestion(7, 'cloze', target, ['a', 'b', 'c', 'd']);

		expect(sent).toEqual({
			id: 7,
			type: 'cloze',
			sentence: `The ${BLANK} rabbit hid under the bush.`,
			choices: ['a', 'b', 'c', 'd']
		});
	});

	it('gives only the first letter and the length for a spelling question', () => {
		const sent = publicQuestion(7, 'spell', target, []);

		expect(sent).toEqual({
			id: 7,
			type: 'spell',
			definition: 'shy and easily scared',
			sentence: `The ${BLANK} rabbit hid under the bush.`,
			firstLetter: 't',
			length: 5
		});
		expect(JSON.stringify(sent)).not.toContain('timid');
	});
});

describe('isCorrect', () => {
	it('needs the exact choice for multiple choice', () => {
		expect(isCorrect('word_to_def', 'very big', 'very big')).toBe(true);
		expect(isCorrect('word_to_def', 'very big', 'very small')).toBe(false);
		expect(isCorrect('cloze', 'timid', 'Timid')).toBe(false);
	});

	it('ignores capitals and outer spaces for spelling, but not wrong letters', () => {
		expect(isCorrect('spell', 'enormous', '  Enormous ')).toBe(true);
		expect(isCorrect('spell', 'enormous', 'ENORMOUS')).toBe(true);
		expect(isCorrect('spell', 'enormous', 'enormus')).toBe(false);
		expect(isCorrect('spell', 'enormous', 'enorm ous')).toBe(false);
	});
});

describe('composePlan', () => {
	const base: PlanInput = {
		due: [],
		fresh: [],
		early: [],
		questionsPerSession: 10,
		newWordsPerSession: 4,
		spellingEnabled: true
	};
	const fresh = [101, 102, 103, 104, 105, 106];
	const count = (plan: { wordId: number }[], wordId: number) =>
		plan.filter((item) => item.wordId === wordId).length;

	it('is empty when there is nothing to ask', () => {
		expect(composePlan(base)).toEqual([]);
	});

	it('on the first day introduces four words and practices each three ways to fill ten', () => {
		const plan = composePlan({ ...base, fresh });

		expect(plan).toHaveLength(10);
		expect(plan.slice(0, 4)).toEqual([
			{ wordId: 101, type: 'word_to_def' },
			{ wordId: 102, type: 'word_to_def' },
			{ wordId: 103, type: 'word_to_def' },
			{ wordId: 104, type: 'word_to_def' }
		]);
		expect(plan.slice(4, 8).map((item) => item.type)).toEqual(Array(4).fill('def_to_word'));
		expect(plan.slice(8).map((item) => item.type)).toEqual(['cloze', 'cloze']);
		// No fifth new word, however short the session would otherwise be.
		expect(new Set(plan.map((item) => item.wordId))).toEqual(new Set([101, 102, 103, 104]));
	});

	it('never asks the same word the same way twice', () => {
		const plan = composePlan({ ...base, fresh });
		const keys = plan.map((item) => `${item.wordId}:${item.type}`);

		expect(new Set(keys).size).toBe(keys.length);
	});

	it('puts due reviews first, asked according to their box', () => {
		const due = [
			{ wordId: 1, box: 1 },
			{ wordId: 2, box: 3 },
			{ wordId: 3, box: 4 },
			{ wordId: 4, box: 5 }
		];
		const plan = composePlan({ ...base, due, fresh });

		expect(plan.slice(0, 4)).toEqual([
			{ wordId: 1, type: 'word_to_def' },
			{ wordId: 2, type: 'def_to_word' },
			{ wordId: 3, type: 'cloze' },
			{ wordId: 4, type: 'spell' }
		]);
		expect(plan.slice(4, 8).map((item) => item.wordId)).toEqual([101, 102, 103, 104]);
		expect(plan).toHaveLength(10);
	});

	it('leaves out new words when reviews fill the session', () => {
		const due = Array.from({ length: 14 }, (_, index) => ({ wordId: index + 1, box: 2 }));
		const plan = composePlan({ ...base, due, fresh });

		expect(plan.map((item) => item.wordId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	it('adds only as many new words as there is room for', () => {
		const due = Array.from({ length: 8 }, (_, index) => ({ wordId: index + 1, box: 2 }));
		const plan = composePlan({ ...base, due, fresh });

		expect(plan.slice(8).map((item) => item.wordId)).toEqual([101, 102]);
	});

	it('respects the parent’s settings', () => {
		const plan = composePlan({ ...base, fresh, questionsPerSession: 6, newWordsPerSession: 2 });

		expect(plan).toHaveLength(6);
		expect(new Set(plan.map((item) => item.wordId))).toEqual(new Set([101, 102]));
		expect(count(plan, 101)).toBe(3);
	});

	it('does not ask spelling questions when they are turned off', () => {
		const plan = composePlan({ ...base, due: [{ wordId: 1, box: 5 }], spellingEnabled: false });

		expect(plan.map((item) => item.type)).not.toContain('spell');
	});

	it('fills with words that are nearly due before repeating this session’s words', () => {
		const due = [{ wordId: 1, box: 2 }];
		const early = [
			{ wordId: 50, box: 3 },
			{ wordId: 51, box: 2 }
		];
		const plan = composePlan({ ...base, due, early, fresh: [101] });

		expect(plan.slice(0, 4)).toEqual([
			{ wordId: 1, type: 'word_to_def' },
			{ wordId: 101, type: 'word_to_def' },
			{ wordId: 50, type: 'def_to_word' },
			{ wordId: 51, type: 'word_to_def' }
		]);
		// The rest is second and third looks, newest word first.
		expect(plan[4]).toEqual({ wordId: 101, type: 'def_to_word' });
	});

	it('is shorter than asked for when there are not enough words', () => {
		const plan = composePlan({ ...base, fresh: [101] });

		expect(plan).toEqual([
			{ wordId: 101, type: 'word_to_def' },
			{ wordId: 101, type: 'def_to_word' },
			{ wordId: 101, type: 'cloze' }
		]);
	});
});

describe('withRetry', () => {
	const plan = [1, 2, 3, 4, 5].map((wordId) => ({ wordId, type: 'word_to_def' as const }));

	it('asks a missed word again after two other questions', () => {
		const result = withRetry(plan, 0, 1);

		expect(result.map((item) => item.wordId)).toEqual([1, 2, 3, 1, 4, 5]);
		expect(result[3]).toEqual({ wordId: 1, type: 'word_to_def' });
	});

	it('puts it at the end when fewer than two questions are left', () => {
		expect(withRetry(plan, 3, 4).map((item) => item.wordId)).toEqual([1, 2, 3, 4, 5, 4]);
		expect(withRetry(plan, 4, 5).map((item) => item.wordId)).toEqual([1, 2, 3, 4, 5, 5]);
	});

	it('adds nothing when the word is already coming up again', () => {
		const withSecondLook = [...plan, { wordId: 1, type: 'def_to_word' as const }];

		expect(withRetry(withSecondLook, 0, 1)).toEqual(withSecondLook);
	});

	it('stops after a word has been asked four times in a session', () => {
		let current: PlanItem[] = [{ wordId: 1, type: 'word_to_def' }];
		for (let position = 0; position < 10; position++) {
			if (position >= current.length) break;
			current = withRetry(current, position, 1);
		}

		expect(current).toHaveLength(4);
	});

	it('does not change the plan it was given', () => {
		const before = structuredClone(plan);
		withRetry(plan, 0, 1);

		expect(plan).toEqual(before);
	});
});
