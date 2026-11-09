import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { openDatabase, type Db } from './client.ts';

let db: Db | undefined;

/**
 * Returns the shared database connection, opening it on first use.
 * Opening is lazy so that `vite build` never touches the filesystem.
 */
export function getDb(): Db {
	if (!db) {
		const dataDir = path.resolve(DATA_DIR);
		mkdirSync(dataDir, { recursive: true });
		// Migrations ship next to the app: ./drizzle in the repo and in the container image.
		db = openDatabase(path.join(dataDir, 'vocab.db'), path.resolve('drizzle'));
	}
	return db;
}
