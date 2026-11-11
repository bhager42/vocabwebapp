import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pruneBackups, writeBackup } from '../backup.ts';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/**
 * How many migrations in `migrationsFolder` have not been applied yet. Zero for a brand
 * new database too: there is nothing in it to protect.
 */
export function pendingMigrations(client: Database.Database, migrationsFolder: string): number {
	const hasTable = (name: string) =>
		client.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name) !==
		undefined;
	if (!hasTable('__drizzle_migrations')) return 0;

	// Drizzle notes the time stamp of each migration it has run, and runs the ones in the
	// journal that are newer than the newest of those. This counts them the same way.
	const journal = JSON.parse(
		readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')
	) as { entries: { when: number }[] };
	const { newest } = client
		.prepare('select max(created_at) as newest from __drizzle_migrations')
		.get() as { newest: number | null };
	return journal.entries.filter((entry) => entry.when > (newest ?? 0)).length;
}

/**
 * Opens (creating if needed) the SQLite database at `file`, applies the pragmas the
 * app relies on, and runs any pending migrations from `migrationsFolder`.
 *
 * When `backupDir` is given and there are migrations to run on an existing database, a
 * copy is written there first (pre-migrate-<time>.db), so an update that goes wrong can
 * be undone by putting that file back.
 *
 * This module has no SvelteKit imports so it can be used from scripts and unit tests.
 */
export function openDatabase(file: string, migrationsFolder: string, backupDir?: string): Db {
	const client = new Database(file);
	client.pragma('journal_mode = WAL');
	client.pragma('synchronous = NORMAL');
	client.pragma('foreign_keys = ON');
	client.pragma('busy_timeout = 5000');

	if (backupDir && pendingMigrations(client, migrationsFolder) > 0) {
		const copy = writeBackup(client, backupDir, 'pre-migrate');
		pruneBackups(backupDir, 'pre-migrate');
		console.log(`Database copied to ${copy} before updating its structure.`);
	}

	const db = drizzle(client, { schema });
	migrate(db, { migrationsFolder });
	return db;
}
