import { error } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { setReadingGrade } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import { PERIODS, scopeFor, type Period } from '#lib/server/metrics.ts';
import { childFromParam } from '#lib/server/params.ts';
import {
	listAttempts,
	MOVE_UP_STORIES,
	nextReadingGrade,
	readingFigures,
	readiness,
	storiesByGrade
} from '#lib/server/reading.ts';
import { appTimeZone, formatDateTime } from '#lib/server/time.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	requireParent(locals);
	const child = childFromParam(params.id);
	const db = getDb();
	const now = new Date();
	const timeZone = appTimeZone();

	const asked = url.searchParams.get('range');
	const period: Period = PERIODS.find((option) => option === asked) ?? '7d';
	const next = nextReadingGrade(db, child.readingGrade);
	const ready = readiness(db, child.id, child.readingGrade);

	return {
		period,
		readingGrade: child.readingGrade,
		figures: readingFigures(db, scopeFor(child.id, period, now, timeZone)),
		readiness: ready,
		byGrade: storiesByGrade(db, child.id),
		storiesNeeded: MOVE_UP_STORIES,
		moveUpTo: ready.ready && next !== null ? next : null,
		nextGrade: next,
		movesUpAutomatically: child.settings.autoUnlockReadingGrade,
		attempts: listAttempts(db, child.id, now).map((attempt) => ({
			id: attempt.id,
			title: attempt.title,
			grade: attempt.grade,
			when: formatDateTime(attempt.startedAt, timeZone),
			state: attempt.state,
			right: attempt.right,
			answered: attempt.answered,
			total: attempt.total
		}))
	};
};

export const actions: Actions = {
	/** "Move up to reading grade N". Only offered, and only accepted, when ready. */
	moveUp: ({ locals, params }) => {
		requireParent(locals);
		const child = childFromParam(params.id);
		const db = getDb();
		const next = nextReadingGrade(db, child.readingGrade);
		if (next === null || !readiness(db, child.id, child.readingGrade).ready) {
			error(400, 'Not ready to move up');
		}
		setReadingGrade(db, child.id, next);
		return { movedTo: next };
	}
};
