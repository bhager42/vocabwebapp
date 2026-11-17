// Validates the reading stories in ./content/reading. Run with: npm run reading:check
// Exits with status 1 if any rule is broken. See PLAN.md Phase 12.

import path from 'node:path';
import process from 'node:process';
import { loadReading } from '../src/lib/server/content/load.ts';
import { countWords, readability, validateStories } from '../src/lib/server/content/reading.ts';

const grades = loadReading(path.resolve('content/reading'));
const issues = validateStories(grades);

for (const { grade, stories } of grades) {
	console.log(`Grade ${grade}: ${stories.length} stories`);
	for (const story of stories) {
		if (!Array.isArray(story.paragraphs)) continue;
		const text = story.paragraphs.join('\n\n');
		const kinds = (story.questions ?? []).map((question) => question.kind).join(', ');
		console.log(
			`  ${story.id}: ${story.paragraphs.length} paragraphs, ${countWords(text)} words, ` +
				`reads at grade ${readability(text).toFixed(1)}; ${kinds}`
		);
	}
}

for (const issue of issues) {
	const subject = issue.story ? `"${issue.story}"` : 'file';
	console.error(`Grade ${issue.grade} ${subject} [${issue.rule}]: ${issue.message}`);
}

if (issues.length > 0) {
	console.error(`\n${issues.length} problem${issues.length === 1 ? '' : 's'} found.`);
	process.exit(1);
}
console.log('\nAll reading checks passed.');
