import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { openDatabase, type Db } from './client.ts';

let db: Db | undefined;

/** Where the database lives. */
export const dataDir = () => path.resolve(DATA_DIR);
/** Where copies of the database are kept. */
export const backupDir = () => path.join(dataDir(), 'backups');

/**
 * Returns the shared database connection, opening it on first use.
 * Opening is lazy so that `vite build` never touches the filesystem.
 */
export function getDb(): Db {
	if (!db) {
		mkdirSync(dataDir(), { recursive: true });
		// Migrations ship next to the app: ./drizzle in the repo and in the container image.
		db = openDatabase(path.join(dataDir(), 'vocab.db'), path.resolve('drizzle'), backupDir());
	}
	return db;
}
