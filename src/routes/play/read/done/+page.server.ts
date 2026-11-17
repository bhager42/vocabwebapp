import { redirect } from '@sveltejs/kit';
import { requireChild } from '#lib/server/auth/guard.ts';
import { getChild } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import { lastReadingSummary } from '#lib/server/reading.ts';
import { appTimeZone } from '#lib/server/time.ts';
import type { PageServerLoad } from './$types';

// The end-of-story page. Shown only just after finishing a story.
export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const who = getChild(db, requireChild(locals).id);
	const summary = who && lastReadingSummary(db, who, new Date(), appTimeZone());
	if (!who || !summary) redirect(303, '/');
	return { name: who.name, summary };
};
