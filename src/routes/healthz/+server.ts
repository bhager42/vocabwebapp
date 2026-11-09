import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { setting } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

const noStore = { 'Cache-Control': 'no-store' };

/** Liveness check that also proves the database file is writable. */
export const GET: RequestHandler = () => {
	try {
		const value = String(Date.now());
		getDb()
			.insert(setting)
			.values({ key: 'healthz_last_ok', value })
			.onConflictDoUpdate({ target: setting.key, set: { value } })
			.run();
		return json({ status: 'ok' }, { headers: noStore });
	} catch (error) {
		console.error(
			'healthz: database write failed:',
			error instanceof Error ? error.message : error
		);
		return json({ status: 'error' }, { status: 503, headers: noStore });
	}
};
