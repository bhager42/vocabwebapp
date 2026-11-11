// Validates the built-in word lists in ./content. Run with: npm run content:check
// Exits with status 1 if any rule is broken.

import path from 'node:path';
import process from 'node:process';
import { loadContent } from '../src/lib/server/content/load.ts';
import { validateContent } from '../src/lib/server/content/validate.ts';

export const EXPECTED_GRADES = [3, 4, 5, 6, 7, 8];
export const WORDS_PER_GRADE = 120;

const grades = loadContent(path.resolve('content'));
const issues = validateContent(grades, { wordsPerGrade: WORDS_PER_GRADE });

const found = grades.map((content) => content.grade);
const missing = EXPECTED_GRADES.filter((grade) => !found.includes(grade));

for (const { grade, words } of grades) {
	const byPart = new Map<string, number>();
	for (const entry of words)
		byPart.set(entry.partOfSpeech, (byPart.get(entry.partOfSpeech) ?? 0) + 1);
	const breakdown = [...byPart].map(([part, count]) => `${count} ${part}`).join(', ');
	console.log(`Grade ${grade}: ${words.length} words (${breakdown})`);
}

for (const grade of missing) console.error(`Grade ${grade}: content file is missing`);
for (const issue of issues) {
	const subject = issue.word ? `"${issue.word}"` : 'list';
	console.error(`Grade ${issue.grade} ${subject} [${issue.rule}]: ${issue.message}`);
}

const problems = issues.length + missing.length;
if (problems > 0) {
	console.error(`\n${problems} problem${problems === 1 ? '' : 's'} found.`);
	process.exit(1);
}
console.log('\nAll content checks passed.');
