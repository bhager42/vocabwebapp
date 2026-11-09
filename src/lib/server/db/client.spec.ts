import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from './client.ts';
import { child, word, wordProgress } from './schema.ts';

const MIGRATIONS = path.resolve('drizzle');

let dir: string;
let db: Db;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'vocab-db-'));
	db = openDatabase(path.join(dir, 'test.db'), MIGRATIONS);
});

afterEach(() => {
	db.$client.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase', () => {
	it('uses WAL mode with foreign keys on', () => {
		expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
		expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('creates every table from PLAN.md section 3.3', () => {
		const tables = db.$client
			.prepare("select name from sqlite_master where type = 'table'")
			.pluck()
			.all();

		expect(tables).toEqual(
			expect.arrayContaining([
				'parent',
				'child',
				'auth_session',
				'word_list',
				'word',
				'word_progress',
				'practice_session',
				'question',
				'answer',
				'login_attempt',
				'setting'
			])
		);
	});

	it('is idempotent: reopening an existing database applies no further migrations', () => {
		db.insert(child).values({ name: 'Sam', nameNormalized: 'sam', createdAt: new Date() }).run();
		db.$client.close();

		db = openDatabase(path.join(dir, 'test.db'), MIGRATIONS);

		expect(db.select().from(child).all()).toHaveLength(1);
	});

	it('enforces foreign keys', () => {
		expect(() =>
			db
				.insert(word)
				.values({
					listId: 999,
					word: 'brave',
					partOfSpeech: 'adjective',
					definition: 'not afraid',
					sentence: 'The brave girl spoke up.'
				})
				.run()
		).toThrow(/FOREIGN KEY/);
	});

	it('enforces unique normalized child names', () => {
		const row = { name: 'Sam', nameNormalized: 'sam', createdAt: new Date() };
		db.insert(child).values(row).run();

		expect(() => db.insert(child).values(row).run()).toThrow(/UNIQUE/);
	});

	it('rejects a Leitner box outside 1 to 5', () => {
		expect(() =>
			db
				.insert(wordProgress)
				.values({ childId: 1, wordId: 1, box: 6, dueAt: new Date(), firstSeenAt: new Date() })
				.run()
		).toThrow(/CHECK|FOREIGN KEY/);
	});
});
