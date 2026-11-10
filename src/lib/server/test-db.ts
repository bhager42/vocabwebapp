import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase, type Db } from './db/client.ts';

/** A throwaway, fully migrated database for unit tests. Call `close()` when done. */
export function createTestDb(): { db: Db; close: () => void } {
	const dir = mkdtempSync(path.join(tmpdir(), 'vocab-test-'));
	const db = openDatabase(path.join(dir, 'test.db'), path.resolve('drizzle'));
	return {
		db,
		close: () => {
			db.$client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}
