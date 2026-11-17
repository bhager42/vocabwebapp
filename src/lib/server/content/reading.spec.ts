import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadReading } from './load.ts';
import {
	countSentences,
	countWords,
	readability,
	syllables,
	validateStories,
	type ReadingRule,
	type Story,
	type StoryQuestion
} from './reading.ts';

describe('measuring text', () => {
	it('counts words, with contractions as one word', () => {
		expect(countWords("Leo's dog didn't bark.")).toBe(4);
	});

	it('counts sentences, including ones ending in a quote', () => {
		expect(countSentences('He ran. "Stop!" she said. Was it over?')).toBe(3);
		expect(countSentences('no ending')).toBe(1);
	});

	it('counts syllables by rule of thumb', () => {
		expect(syllables('cat')).toBe(1);
		expect(syllables('garden')).toBe(2);
		expect(syllables('cake')).toBe(1);
		expect(syllables('photographs')).toBe(3);
		expect(syllables('reading')).toBe(2);
	});

	it('scores easy text lower than hard text', () => {
		const easy = 'The cat sat. The dog ran. I like it.';
		const hard =
			'Considerable environmental transformations accompanied the extraordinary industrialization of the region.';
		expect(readability(easy)).toBeLessThan(2);
		expect(readability(hard)).toBeGreaterThan(12);
	});
});

// A grade 3 story that passes every rule; each test below breaks one thing.
const SENTENCE = 'The happy puppy ran to the park with his best friend Max.';
const paragraph = (extra = '') => `${SENTENCE} ${SENTENCE} ${SENTENCE} ${SENTENCE} ${extra}`.trim();

const question = (kind: StoryQuestion['kind'], overrides: Partial<StoryQuestion> = {}) => ({
	kind,
	prompt: 'Where did the dog run?',
	correct: 'To the park',
	wrong: ['To the store', 'To the lake', 'To the school'],
	explanation: 'The story says he ran to the park.',
	evidence: ['ran to the park'],
	...overrides
});

function story(overrides: Partial<Story> = {}): Story {
	return {
		id: 'the-dog',
		title: 'The Dog',
		paragraphs: [
			paragraph(),
			paragraph(),
			paragraph(),
			paragraph('He was happy and wagged his long tail all day.')
		],
		questions: [
			question('literal'),
			question('literal', {
				prompt: 'Who went with the dog?',
				correct: 'Max',
				wrong: ['Sam', 'Ana', 'Leo'],
				evidence: ['his best friend Max']
			}),
			question('inference', {
				correct: 'He enjoyed the trip',
				wrong: ['He was sad', 'He was lost', 'He was cold'],
				evidence: ['wagged his long tail']
			}),
			question('inference', {
				correct: 'They are close friends',
				wrong: ['They just met', 'They do not get along', 'They are cousins'],
				evidence: ['his best friend Max']
			}),
			question('main_idea', {
				correct: 'A happy trip to the park',
				wrong: ['A lost dog', 'A rainy day', 'A new house']
			})
		],
		...overrides
	};
}

const rules = (stories: Story[], grade = 3): ReadingRule[] =>
	validateStories([{ grade, stories }]).map((issue) => issue.rule);

describe('validateStories', () => {
	it('passes a good story', () => {
		expect(validateStories([{ grade: 3, stories: [story()] }])).toEqual([]);
	});

	it('checks the shape', () => {
		expect(rules([story({ title: '' })])).toEqual(['shape']);
		expect(rules([{ ...story(), paragraphs: 'text' } as unknown as Story])).toEqual(['shape']);
	});

	it('checks ids', () => {
		expect(rules([story({ id: 'The Dog' })])).toContain('id-format');
		expect(rules([story(), story()])).toContain('duplicate-id');
		expect(
			validateStories([
				{ grade: 3, stories: [story()] },
				{ grade: 4, stories: [story()] }
			]).some((issue) => issue.rule === 'duplicate-id')
		).toBe(true);
	});

	it('checks paragraphs, words and reading level for the grade', () => {
		expect(rules([story({ paragraphs: [paragraph(), paragraph()] })])).toContain('paragraph-count');
		expect(rules([story({ paragraphs: ['Short.', 'Short.', 'Short.'] })])).toContain('word-count');
		const hard =
			'Considerable environmental transformations accompanied the extraordinary industrialization of the region, which subsequently necessitated comprehensive governmental regulation.';
		expect(rules([story({ paragraphs: [hard, hard, hard, hard, hard] })])).toContain('readability');
	});

	it('checks the number and kinds of questions', () => {
		const s = story();
		expect(rules([story({ questions: s.questions.slice(0, 4) })])).toContain('question-count');
		const allLiteral = s.questions.map((entry) => ({ ...entry, kind: 'literal' as const }));
		expect(rules([story({ questions: allLiteral })])).toContain('question-kinds');
		const noOther = [...s.questions.slice(0, 4), { ...s.questions[2] }];
		expect(rules([story({ questions: noOther })])).toContain('question-kinds');
	});

	it('needs three different wrong answers', () => {
		const s = story();
		const twoWrong = [
			{ ...s.questions[0], wrong: ['To the store', 'To the lake'] },
			...s.questions.slice(1)
		];
		expect(rules([story({ questions: twoWrong })])).toContain('choices');
		const repeated = [
			{ ...s.questions[0], wrong: ['To the store', 'to the store', 'To the lake'] },
			...s.questions.slice(1)
		];
		expect(rules([story({ questions: repeated })])).toContain('choices');
		const rightTwice = [
			{ ...s.questions[0], wrong: ['To the park', 'To the lake', 'To the school'] },
			...s.questions.slice(1)
		];
		expect(rules([story({ questions: rightTwice })])).toContain('choices');
	});

	it('needs evidence copied word for word from the story', () => {
		const s = story();
		const missing = [{ ...s.questions[0], evidence: [] }, ...s.questions.slice(1)];
		expect(rules([story({ questions: missing })])).toContain('evidence');
		const madeUp = [{ ...s.questions[0], evidence: ['ran to the beach'] }, ...s.questions.slice(1)];
		expect(rules([story({ questions: madeUp })])).toContain('evidence');
		// Case and curly quotes do not matter.
		const recased = [{ ...s.questions[0], evidence: ['RAN TO THE PARK'] }, ...s.questions.slice(1)];
		expect(rules([story({ questions: recased })])).toEqual([]);
	});

	it('rejects an inference answer that is written in the story', () => {
		const s = story();
		const stated = [
			...s.questions.slice(0, 2),
			{ ...s.questions[2], correct: 'He was happy' },
			...s.questions.slice(3)
		];
		expect(rules([story({ questions: stated })])).toContain('inference-stated');
	});

	it('rejects a right answer much longer than the wrong ones', () => {
		const s = story();
		const long = [
			{
				...s.questions[0],
				correct: 'To the big green park at the end of the street near the school'
			},
			...s.questions.slice(1)
		];
		expect(rules([story({ questions: long })])).toContain('answer-length');
	});

	it('rejects blocked words anywhere', () => {
		const s = story();
		const rude = [{ ...s.questions[0], explanation: 'What the hell.' }, ...s.questions.slice(1)];
		expect(rules([story({ questions: rude })])).toContain('blocked-word');
	});

	it('reports a grade it has no limits for', () => {
		expect(rules([story()], 1)).toEqual(['shape']);
	});
});

describe('the shipped stories', () => {
	it('pass every rule', () => {
		const grades = loadReading(path.resolve('content/reading'));
		expect(grades.map((grade) => grade.grade)).toContain(3);
		expect(validateStories(grades)).toEqual([]);
	});
});
