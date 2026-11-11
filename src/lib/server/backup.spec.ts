import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEEP, listBackups, nightlyDue, pruneBackups, runNightly, writeBackup } from './backup.ts';
import { openDatabase, pendingMigrations } from './db/client.ts';
import { child } from './db/schema.ts';

const MIGRATIONS = path.resolve('drizzle');
const HOUR = 60 * 60_000;
const at = (iso: string) => new Date(iso);

let dir: string;
let backups: string;
let file: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'vocab-backup-'));
	backups = path.join(dir, 'backups');
	file = path.join(dir, 'vocab.db');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function withChild(name: string) {
	const db = openDatabase(file, MIGRATIONS);
	db.insert(child)
		.values({ name, nameNormalized: name.toLowerCase(), createdAt: new Date() })
		.run();
	return db;
}

describe('writeBackup', () => {
	it('writes a complete database that opens on its own', () => {
		const db = withChild('Sam');
		const copy = writeBackup(db.$client, backups, 'nightly', at('2026-11-10T08:00:00Z'));
		db.$client.close();

		expect(path.basename(copy)).toBe('nightly-20261110-080000.db');
		const restored = new Database(copy, { readonly: true });
		expect(restored.prepare('select name from child').all()).toEqual([{ name: 'Sam' }]);
		expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
		restored.close();
	});

	it('includes changes that are still only in the write-ahead log', () => {
		// In WAL mode recent writes sit in vocab.db-wal; copying vocab.db alone would miss them.
		const db = withChild('Sam');
		db.$client.pragma('wal_autocheckpoint = 0');
		db.insert(child).values({ name: 'Mia', nameNormalized: 'mia', createdAt: new Date() }).run();
		const copy = writeBackup(db.$client, backups, 'download');
		db.$client.close();

		const restored = new Database(copy, { readonly: true });
		expect(restored.prepare('select count(*) as n from child').get()).toEqual({ n: 2 });
		restored.close();
	});

	it('leaves no half-written file behind', () => {
		const db = withChild('Sam');
		writeBackup(db.$client, backups, 'nightly');
		db.$client.close();
		expect(readdirSync(backups).filter((name) => name.endsWith('.partial'))).toEqual([]);
	});

	it('copes with a quote in the folder name', () => {
		const odd = path.join(dir, "it's here");
		const db = withChild('Sam');
		const copy = writeBackup(db.$client, odd, 'nightly');
		db.$client.close();
		expect(listBackups(odd).map((backup) => path.join(odd, backup.name))).toEqual([copy]);
	});
});

describe('listBackups', () => {
	it('is empty when the folder does not exist', () => {
		expect(listBackups(backups)).toEqual([]);
	});

	it('lists backups newest first and ignores other files', () => {
		const db = withChild('Sam');
		writeBackup(db.$client, backups, 'nightly', at('2026-11-09T08:00:00Z'));
		writeBackup(db.$client, backups, 'pre-migrate', at('2026-11-10T09:30:00Z'));
		writeBackup(db.$client, backups, 'nightly', at('2026-11-10T08:00:00Z'));
		db.$client.close();
		writeFileSync(path.join(backups, 'notes.txt'), 'hello');
		writeFileSync(path.join(backups, 'nightly-20261111-080000.db.partial'), '');

		const found = listBackups(backups);
		expect(found.map((backup) => backup.name)).toEqual([
			'pre-migrate-20261110-093000.db',
			'nightly-20261110-080000.db',
			'nightly-20261109-080000.db'
		]);
		expect(found[0]).toMatchObject({
			kind: 'pre-migrate',
			createdAt: at('2026-11-10T09:30:00Z')
		});
		expect(found[0].bytes).toBeGreaterThan(0);
	});
});

describe('pruneBackups', () => {
	it('keeps the newest 14 nightly backups and leaves other kinds alone', () => {
		const db = withChild('Sam');
		for (let day = 1; day <= 16; day++) {
			writeBackup(db.$client, backups, 'nightly', new Date(Date.UTC(2026, 9, day, 8)));
		}
		writeBackup(db.$client, backups, 'pre-migrate', at('2026-01-01T00:00:00Z'));
		db.$client.close();

		expect(pruneBackups(backups, 'nightly')).toEqual([
			'nightly-20261002-080000.db',
			'nightly-20261001-080000.db'
		]);
		const left = listBackups(backups);
		expect(left.filter((backup) => backup.kind === 'nightly')).toHaveLength(KEEP.nightly);
		expect(left.at(-1)!.name).toBe('pre-migrate-20260101-000000.db');
	});

	it('clears out half-written files', () => {
		const db = withChild('Sam');
		writeBackup(db.$client, backups, 'nightly');
		db.$client.close();
		writeFileSync(path.join(backups, 'nightly-20200101-000000.db.partial'), 'junk');

		pruneBackups(backups, 'nightly');
		expect(readdirSync(backups).filter((name) => name.endsWith('.partial'))).toEqual([]);
	});
});

describe('nightly backups', () => {
	it('are due when there is none, and again about a day later', () => {
		const db = withChild('Sam');
		const first = at('2026-11-10T08:00:00Z');
		expect(nightlyDue(backups, first)).toBe(true);

		expect(runNightly(db.$client, backups, first)).toMatch(/nightly-20261110-080000\.db$/);
		// An hour later, and 23 hours later: not yet.
		expect(runNightly(db.$client, backups, new Date(first.getTime() + HOUR))).toBeNull();
		expect(runNightly(db.$client, backups, new Date(first.getTime() + 23 * HOUR))).toBeNull();
		// The hourly check that lands on 24 hours makes the next one.
		expect(runNightly(db.$client, backups, new Date(first.getTime() + 24 * HOUR))).toMatch(
			/nightly-20261111-080000\.db$/
		);
		db.$client.close();
		expect(listBackups(backups)).toHaveLength(2);
	});

	it('does not count a backup of another kind', () => {
		const db = withChild('Sam');
		writeBackup(db.$client, backups, 'pre-migrate', at('2026-11-10T08:00:00Z'));
		expect(nightlyDue(backups, at('2026-11-10T08:05:00Z'))).toBe(true);
		db.$client.close();
	});
});

describe('backup before a structure change', () => {
	it('is not made for a brand new database', () => {
		openDatabase(file, MIGRATIONS, backups).$client.close();
		expect(listBackups(backups)).toEqual([]);
	});

	it('is not made when the database is already up to date', () => {
		withChild('Sam').$client.close();
		openDatabase(file, MIGRATIONS, backups).$client.close();
		expect(listBackups(backups)).toEqual([]);
	});

	it('is made when an update has migrations to run, and holds the data from before', () => {
		withChild('Sam').$client.close();

		// Make the database look one version behind: forget that the newest migration ran.
		const raw = new Database(file);
		raw.exec(
			'delete from __drizzle_migrations where created_at = (select max(created_at) from __drizzle_migrations)'
		);
		expect(pendingMigrations(raw, MIGRATIONS)).toBe(1);
		// Undo what that migration added, so that it can run again.
		raw.exec('alter table practice_session drop column plan_json');
		raw.exec('drop index login_attempt_ip_idx');
		raw.exec('alter table login_attempt drop column scope');
		raw.exec('create index login_attempt_ip_idx on login_attempt (ip, at)');
		raw.close();

		const db = openDatabase(file, MIGRATIONS, backups);
		expect(pendingMigrations(db.$client, MIGRATIONS)).toBe(0);
		db.$client.close();

		const [copy] = listBackups(backups);
		expect(copy.kind).toBe('pre-migrate');
		const before = new Database(path.join(backups, copy.name), { readonly: true });
		expect(before.prepare('select name from child').all()).toEqual([{ name: 'Sam' }]);
		// The copy is from before the update: it does not have the new column.
		const columns = before.pragma('table_info(practice_session)') as { name: string }[];
		expect(columns.map((column) => column.name)).not.toContain('plan_json');
		before.close();
	});
});
