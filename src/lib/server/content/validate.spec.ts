import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContent, parseGradeFile } from './load.ts';
import { GRADES } from '../children.ts';
import {
	countWord,
	isDistractorFor,
	validateContent,
	type ContentEntry,
	type GradeContent,
	type Rule
} from './validate.ts';

const entry = (word: string, overrides: Partial<ContentEntry> = {}): ContentEntry => ({
	word,
	partOfSpeech: 'noun',
	definition: 'a thing used in tests',
	sentence: `I saw a ${word} today.`,
	synonyms: [],
	...overrides
});

/** A valid grade: four nouns, so each has three usable wrong choices. */
const validGrade = (grade = 3): GradeContent => ({
	grade,
	words: [entry('apple'), entry('boat'), entry('cloud'), entry('drum')]
});

const rulesFor = (grades: GradeContent[], word: string): Rule[] =>
	validateContent(grades)
		.filter((issue) => issue.word === word)
		.map((issue) => issue.rule);

/** Replaces "apple" in an otherwise valid grade and returns the rules it breaks. */
const rulesWith = (overrides: Partial<ContentEntry>): Rule[] => {
	const grade = validGrade();
	grade.words[0] = entry('apple', overrides);
	return rulesFor([grade], overrides.word ?? 'apple');
};

describe('countWord', () => {
	it('matches whole words only, ignoring case', () => {
		expect(countWord('Rare birds are rarely seen. RARE!', 'rare')).toBe(2);
		expect(countWord('A carefree day', 'care')).toBe(0);
		expect(countWord("The team's flag", 'team')).toBe(1);
	});
});

describe('validateContent', () => {
	it('accepts a valid list', () => {
		expect(validateContent([validGrade()])).toEqual([]);
	});

	it('rejects words that are not plain lower-case letters', () => {
		expect(rulesWith({ word: 'Apple', sentence: 'I saw an Apple today.' })).toContain(
			'word-format'
		);
		expect(rulesWith({ word: 'ice-cream', sentence: 'I like ice-cream a lot.' })).toContain(
			'word-format'
		);
	});

	it('rejects an unknown part of speech', () => {
		expect(rulesWith({ partOfSpeech: 'pronoun' as ContentEntry['partOfSpeech'] })).toContain(
			'part-of-speech'
		);
	});

	it('rejects a word repeated in the same grade', () => {
		const grade = validGrade();
		grade.words.push(entry('apple'));
		expect(rulesFor([grade], 'apple')).toContain('duplicate-word');
	});

	it('rejects a word repeated in a later grade', () => {
		const later = validGrade(4);
		later.words = [entry('apple'), entry('eagle'), entry('fence'), entry('grape')];
		const issues = validateContent([validGrade(3), later]);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ grade: 4, word: 'apple', rule: 'duplicate-word' });
	});

	it('rejects a definition that contains the word', () => {
		expect(rulesWith({ definition: 'an Apple is a fruit' })).toEqual(['definition-contains-word']);
	});

	it('allows a definition that only contains the word inside a longer word', () => {
		expect(rulesWith({ definition: 'what applesauce is made from' })).toEqual([]);
	});

	it('rejects a definition longer than 15 words', () => {
		const sixteen = Array.from({ length: 16 }, () => 'word').join(' ');
		const fifteen = Array.from({ length: 15 }, () => 'word').join(' ');

		expect(rulesWith({ definition: sixteen })).toEqual(['definition-length']);
		expect(rulesWith({ definition: fifteen })).toEqual([]);
	});

	it('rejects a sentence that does not use the word', () => {
		expect(rulesWith({ sentence: 'I ate two apples today.' })).toEqual(['sentence-word-count']);
	});

	it('rejects a sentence that uses the word more than once', () => {
		expect(rulesWith({ sentence: 'An apple is an apple.' })).toEqual(['sentence-word-count']);
	});

	it('accepts the word capitalized at the start of the sentence', () => {
		expect(rulesWith({ sentence: 'Apple pie is my favorite.' })).toEqual([]);
	});

	it('rejects a sentence with no end punctuation', () => {
		expect(rulesWith({ sentence: 'I saw an apple today' })).toEqual(['sentence-punctuation']);
	});

	it('accepts a sentence that ends with a closing quote', () => {
		expect(rulesWith({ sentence: 'She said, "Pass me an apple."' })).toEqual([]);
	});

	it('rejects a word listed as its own synonym', () => {
		expect(rulesWith({ synonyms: ['apple'] })).toEqual(['synonym-is-word']);
	});

	it('rejects a word with fewer than three usable wrong choices', () => {
		const grade = validGrade();
		grade.words.pop(); // three nouns left, so two wrong choices each
		const issues = validateContent([grade]);

		expect(issues).toHaveLength(3);
		expect(issues.every((issue) => issue.rule === 'too-few-distractors')).toBe(true);
	});

	it('does not count other parts of speech as wrong choices', () => {
		const grade = validGrade();
		grade.words[3] = entry('dance', { partOfSpeech: 'verb', sentence: 'We dance every day.' });

		expect(rulesFor([grade], 'apple')).toEqual(['too-few-distractors']);
	});

	it('does not count synonyms as wrong choices, in either direction', () => {
		const grade = validGrade();
		grade.words[1] = entry('boat', { synonyms: ['apple'] });

		expect(rulesFor([grade], 'apple')).toEqual(['too-few-distractors']);
		expect(rulesFor([grade], 'boat')).toEqual(['too-few-distractors']);
		expect(rulesFor([grade], 'cloud')).toEqual([]);
	});

	it('rejects blocked words anywhere in an entry', () => {
		expect(rulesWith({ definition: 'a damn good fruit' })).toEqual(['blocked-word']);
		expect(rulesWith({ sentence: 'What the hell is an apple?' })).toEqual(['blocked-word']);
	});

	it('does not flag harmless words that contain a blocked word', () => {
		expect(rulesWith({ definition: 'a fruit shaped like a shell or a glass' })).toEqual([]);
	});

	it('checks the size of each grade when asked to', () => {
		const issues = validateContent([validGrade()], { wordsPerGrade: 120 });

		expect(issues).toEqual([
			{ grade: 3, word: '', rule: 'grade-size', message: 'has 4 words, expected 120' }
		]);
	});
});

describe('isDistractorFor', () => {
	it('never offers a word as its own wrong choice', () => {
		expect(isDistractorFor(entry('apple'), entry('apple'))).toBe(false);
		expect(isDistractorFor(entry('apple'), entry('boat'))).toBe(true);
	});
});

describe('parseGradeFile', () => {
	it('parses a well-formed file', () => {
		const text = JSON.stringify(validGrade());
		expect(parseGradeFile(text, 'grade-3.json')).toEqual(validGrade());
	});

	it.each([
		['a missing field', { grade: 3, words: [{ word: 'apple' }] }, /"definition"/],
		['a bad grade', { grade: 'three', words: [] }, /"grade"/],
		['words that are not a list', { grade: 3, words: {} }, /"words"/],
		[
			'synonyms that are not strings',
			{ grade: 3, words: [{ ...entry('apple'), synonyms: [1] }] },
			/"synonyms"/
		],
		[
			'an unknown part of speech',
			{ grade: 3, words: [{ ...entry('apple'), partOfSpeech: 'pronoun' }] },
			/"partOfSpeech"/
		]
	])('rejects %s', (_name, data, message) => {
		expect(() => parseGradeFile(JSON.stringify(data), 'grade-3.json')).toThrow(message);
	});
});

describe('the shipped word lists in ./content', () => {
	const grades = loadContent(path.resolve('content'));

	it('cover every grade a child can be set to, and no others', () => {
		expect(grades.map((content) => content.grade)).toEqual([...GRADES]);
	});

	it('pass every validation rule with 120 words per grade', () => {
		expect(validateContent(grades, { wordsPerGrade: 120 })).toEqual([]);
	});
});
