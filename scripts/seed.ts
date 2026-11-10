// Loads the built-in word lists into the database. Run with: npm run db:seed
//
// The app does this itself on every startup, so this script is only needed to seed a
// database by hand. It is idempotent: running it again changes nothing.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadContent } from '../src/lib/server/content/load.ts';
import { seedBuiltinWords } from '../src/lib/server/content/seed.ts';
import { validateContent } from '../src/lib/server/content/validate.ts';
import { openDatabase } from '../src/lib/server/db/client.ts';

const grades = loadContent(path.resolve('content'));

const issues = validateContent(grades);
if (issues.length > 0) {
	console.error(
		`Content has ${issues.length} problem(s). Run "npm run content:check" for details.`
	);
	process.exit(1);
}

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
mkdirSync(dataDir, { recursive: true });
const db = openDatabase(path.join(dataDir, 'vocab.db'), path.resolve('drizzle'));

const result = seedBuiltinWords(db, grades);
db.$client.close();

console.log(`Seeded ${path.join(dataDir, 'vocab.db')}`);
console.log(
	`  lists created: ${result.listsCreated}, words inserted: ${result.inserted}, ` +
		`updated: ${result.updated}, unchanged: ${result.unchanged}, deactivated: ${result.deactivated}`
);
