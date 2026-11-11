import { readFileSync, rmSync } from 'node:fs';
import { requireParent } from '#lib/server/auth/guard.ts';
import { writeBackup } from '#lib/server/backup.ts';
import { backupDir, getDb } from '#lib/server/db/index.ts';
import { appTimeZone, localDayKey } from '#lib/server/time.ts';
import type { RequestHandler } from './$types';

/**
 * Sends the parent a copy of the whole database, made at this moment. It is a POST so
 * that it can only be started from a form on this site, never by a link from elsewhere.
 */
export const POST: RequestHandler = ({ locals }) => {
	requireParent(locals);

	const now = new Date();
	const file = writeBackup(getDb().$client, backupDir(), 'download', now);
	let bytes: Buffer;
	try {
		// The database of one family is a few megabytes at most, so it is read in one go.
		bytes = readFileSync(file);
	} finally {
		rmSync(file, { force: true });
	}

	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': 'application/vnd.sqlite3',
			'content-length': String(bytes.byteLength),
			'content-disposition': `attachment; filename="vocab-backup-${localDayKey(now, appTimeZone())}.db"`
		}
	});
};
