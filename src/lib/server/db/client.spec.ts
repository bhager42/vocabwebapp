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

describe('the reading migration (0003)', () => {
	it('adds the reading grade without losing any child or their history', async () => {
		const { cpSync, readFileSync, writeFileSync } = await import('node:fs');
		const Database = (await import('better-sqlite3')).default;

		// A copy of the migrations as they were before 0003.
		const before = path.join(dir, 'before');
		cpSync(MIGRATIONS, before, { recursive: true });
		const journalFile = path.join(before, 'meta', '_journal.json');
		const journal = JSON.parse(readFileSync(journalFile, 'utf8'));
		journal.entries = journal.entries.filter((entry: { tag: string }) => entry.tag < '0003');
		writeFileSync(journalFile, JSON.stringify(journal));

		const file = path.join(dir, 'old.db');
		openDatabase(file, before).$client.close();
		const raw = new Database(file);
		raw.exec(`
			insert into child (name, name_normalized, grade, settings_json, created_at) values ('Sam', 'sam', 5, '{}', 1);
			insert into word_list (name, grade, source) values ('Grade 5', 5, 'builtin');
			insert into word (list_id, word, part_of_speech, definition, sentence) values (1, 'brisk', 'adjective', 'quick', 'A brisk walk.');
			insert into word_progress (child_id, word_id, box, due_at, first_seen_at) values (1, 1, 3, 1, 1);
			insert into practice_session (child_id, started_at) values (1, 1);
			insert into placement_quiz (child_id, started_at, start_grade) values (1, 1, 5);
		`);
		raw.close();

		const updated = openDatabase(file, MIGRATIONS);
		const count = (table: string) =>
			(updated.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
		expect(updated.$client.prepare('select name, grade, reading_grade from child').all()).toEqual([
			{ name: 'Sam', grade: 5, reading_grade: 3 }
		]);
		expect(['word_progress', 'practice_session', 'placement_quiz'].map(count)).toEqual([1, 1, 1]);
		expect(updated.$client.pragma('foreign_key_check')).toEqual([]);
		expect(() => updated.$client.prepare('update child set reading_grade = 13').run()).toThrow(
			/CHECK/
		);
		updated.$client.close();
	});
});
