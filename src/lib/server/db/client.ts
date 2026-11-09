import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/**
 * Opens (creating if needed) the SQLite database at `file`, applies the pragmas the
 * app relies on, and runs any pending migrations from `migrationsFolder`.
 *
 * This module has no SvelteKit imports so it can be used from scripts and unit tests.
 */
export function openDatabase(file: string, migrationsFolder: string): Db {
	const client = new Database(file);
	client.pragma('journal_mode = WAL');
	client.pragma('synchronous = NORMAL');
	client.pragma('foreign_keys = ON');
	client.pragma('busy_timeout = 5000');

	const db = drizzle(client, { schema });
	migrate(db, { migrationsFolder });
	return db;
}
