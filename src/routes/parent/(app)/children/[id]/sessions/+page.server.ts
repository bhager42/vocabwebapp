import { requireParent } from '#lib/server/auth/guard.ts';
import { getDb } from '#lib/server/db/index.ts';
import { sessionLog } from '#lib/server/history.ts';
import { childFromParam } from '#lib/server/params.ts';
import { appTimeZone, formatDateTime } from '#lib/server/time.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	requireParent(locals);
	const child = childFromParam(params.id);

	const asked = url.searchParams.get('page') ?? '1';
	const page = /^\d{1,6}$/.test(asked) ? Math.max(1, Number(asked)) : 1;
	const timeZone = appTimeZone();
	const log = sessionLog(getDb(), child.id, new Date(), page);

	return {
		page: Math.min(page, log.pages),
		pages: log.pages,
		sessions: log.sessions.map(({ startedAt, ...session }) => ({
			...session,
			started: formatDateTime(startedAt, timeZone)
		}))
	};
};
