import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PARTS_OF_SPEECH, type ContentEntry, type GradeContent } from './validate.ts';

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';

function parseEntry(raw: unknown, where: string): ContentEntry {
	if (typeof raw !== 'object' || raw === null) throw new Error(`${where}: entry is not an object`);
	const { word, partOfSpeech, definition, sentence, synonyms } = raw as Record<string, unknown>;

	if (!isString(word)) throw new Error(`${where}: "word" must be a non-empty string`);
	const at = `${where} "${word}"`;
	if (!isString(definition)) throw new Error(`${at}: "definition" must be a non-empty string`);
	if (!isString(sentence)) throw new Error(`${at}: "sentence" must be a non-empty string`);
	if (!isString(partOfSpeech) || !(PARTS_OF_SPEECH as readonly string[]).includes(partOfSpeech)) {
		throw new Error(`${at}: "partOfSpeech" must be one of ${PARTS_OF_SPEECH.join(', ')}`);
	}
	if (!Array.isArray(synonyms) || !synonyms.every(isString)) {
		throw new Error(`${at}: "synonyms" must be an array of strings`);
	}

	return {
		word,
		partOfSpeech: partOfSpeech as ContentEntry['partOfSpeech'],
		definition,
		sentence,
		synonyms
	};
}

/** Parses the text of one `grade-N.json` file, throwing if its structure is wrong. */
export function parseGradeFile(text: string, fileName: string): GradeContent {
	const data: unknown = JSON.parse(text);
	if (typeof data !== 'object' || data === null) throw new Error(`${fileName}: not an object`);
	const { grade, words } = data as Record<string, unknown>;

	if (typeof grade !== 'number' || !Number.isInteger(grade) || grade < 1 || grade > 12) {
		throw new Error(`${fileName}: "grade" must be a whole number from 1 to 12`);
	}
	if (!Array.isArray(words)) throw new Error(`${fileName}: "words" must be an array`);

	return { grade, words: words.map((raw, index) => parseEntry(raw, `${fileName} #${index + 1}`)) };
}

/** Loads every `grade-N.json` file in `dir`, sorted by grade. */
export function loadContent(dir: string): GradeContent[] {
	const grades = readdirSync(dir)
		.filter((name) => /^grade-\d+\.json$/.test(name))
		.map((name) => {
			const content = parseGradeFile(readFileSync(path.join(dir, name), 'utf8'), name);
			if (name !== `grade-${content.grade}.json`) {
				throw new Error(`${name}: file name does not match "grade": ${content.grade}`);
			}
			return content;
		})
		.sort((a, b) => a.grade - b.grade);

	if (grades.length === 0) throw new Error(`No grade-N.json files found in ${dir}`);
	return grades;
}
