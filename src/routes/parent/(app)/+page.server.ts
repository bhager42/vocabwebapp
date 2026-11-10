import { error } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { listChildren, setArchived } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import { practiceDays, scopeFor } from '#lib/server/metrics.ts';
import { appTimeZone, formatDay } from '#lib/server/time.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireParent(locals);
	const db = getDb();
	const now = new Date();
	const timeZone = appTimeZone();

	const children = listChildren(db).map(({ id, name, grade, archivedAt }) => {
		const practice = practiceDays(db, scopeFor(id, 'all', now, timeZone));
		return {
			id,
			name,
			grade,
			archived: archivedAt !== null,
			streak: practice.currentStreak,
			lastPracticed: practice.lastDay && formatDay(practice.lastDay)
		};
	});
	return {
		children: children.filter((child) => !child.archived),
		archived: children.filter((child) => child.archived)
	};
};

export const actions: Actions = {
	restore: async ({ locals, request }) => {
		requireParent(locals);
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id) || !setArchived(getDb(), id, false)) error(404, 'Child not found');
		return { restored: true };
	}
};
