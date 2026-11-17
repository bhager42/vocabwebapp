import { error } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { getDb } from '#lib/server/db/index.ts';
import { childFromParam, idParam } from '#lib/server/params.ts';
import { attemptDetail } from '#lib/server/reading.ts';
import { appTimeZone, formatDateTime } from '#lib/server/time.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	requireParent(locals);
	const child = childFromParam(params.id);
	// Only an attempt of this child: another child's id in the address is "not found".
	const detail = attemptDetail(getDb(), child.id, idParam(params.attempt));
	if (!detail) error(404, 'Story not found');
	return {
		attempt: { ...detail, when: formatDateTime(detail.startedAt, appTimeZone()) }
	};
};
