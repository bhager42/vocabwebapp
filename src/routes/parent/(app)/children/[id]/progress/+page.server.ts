import { error } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { GRADES, setGrade } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import {
	accuracy,
	accuracyByType,
	dailyActivity,
	groupByWeek,
	guessing,
	PERIODS,
	practiceDays,
	responseTimes,
	retention,
	scopeFor,
	sessionCounts,
	timeOfDay,
	timePracticed,
	troubleWords,
	wordStatus,
	type Period
} from '#lib/server/metrics.ts';
import { childFromParam } from '#lib/server/params.ts';
import { UNLOCK_SHARE } from '#lib/server/practice.ts';
import { appTimeZone, formatDay, formatHour, formatShortDay } from '#lib/server/time.ts';
import type { Actions, PageServerLoad } from './$types';

/** Past this many days the charts show one point per week. */
const WEEKLY_AFTER_DAYS = 60;

/** The grade the child could move up to, if this one is well enough known. */
function nextGrade(grade: number, known: number): number | null {
	const next = GRADES.find((candidate) => candidate > grade);
	return next !== undefined && known >= UNLOCK_SHARE ? next : null;
}

export const load: PageServerLoad = ({ locals, params, url }) => {
	requireParent(locals);
	const child = childFromParam(params.id);
	const db = getDb();

	const asked = url.searchParams.get('range');
	const period: Period = PERIODS.find((option) => option === asked) ?? '7d';
	const timeZone = appTimeZone();
	const scope = scopeFor(child.id, period, new Date(), timeZone);

	const everyDay = dailyActivity(db, scope);
	const weekly = everyDay.length > WEEKLY_AFTER_DAYS;
	const days = (weekly ? groupByWeek(everyDay) : everyDay).map((entry) => ({
		label: formatShortDay(entry.day),
		longLabel: weekly ? `Week of ${formatDay(entry.day)}` : formatDay(entry.day),
		accuracy: entry.accuracy,
		firstAttempts: entry.firstAttempts,
		firstCorrect: entry.firstCorrect,
		activeMs: entry.activeMs
	}));

	const grades = wordStatus(db, child.id, child.grade);
	const current = grades.find((status) => status.grade === child.grade);
	const practice = practiceDays(db, scope);
	const times = responseTimes(db, scope);
	const hours = timeOfDay(db, scope);

	return {
		period,
		weekly,
		// Whether there has ever been any practice, whatever the period chosen.
		everPracticed: sessionCounts(db, { ...scope, since: null }).started > 0,
		accuracy: accuracy(db, scope),
		activeMs: timePracticed(db, scope),
		practice: {
			daysPracticed: practice.daysPracticed,
			currentStreak: practice.currentStreak,
			longestStreak: practice.longestStreak
		},
		sessions: sessionCounts(db, scope),
		days,
		grades,
		moveUpTo: current ? nextGrade(child.grade, current.known) : null,
		movesUpAutomatically: child.settings.autoUnlockNextGrade,
		trouble: troubleWords(db, scope),
		retention: retention(db, scope),
		types: accuracyByType(db, scope).map((entry, index) => ({
			...entry,
			medianMs: times.byType[index].medianMs
		})),
		medianMs: times.overallMs,
		guessing: guessing(db, scope),
		hours: hours.hours.map((entry) => ({ ...entry, label: formatHour(entry.hour) })),
		bestHour: hours.best ? formatHour(hours.best.hour) : null
	};
};

export const actions: Actions = {
	/** Moves the child up a grade, once the current grade is well enough known. */
	moveUp: ({ locals, params }) => {
		requireParent(locals);
		const child = childFromParam(params.id);
		const db = getDb();

		const current = wordStatus(db, child.id, child.grade).find(
			(status) => status.grade === child.grade
		);
		const next = current ? nextGrade(child.grade, current.known) : null;
		if (next === null) error(400, 'Not ready to move up yet');

		setGrade(db, child.id, next);
		return { movedTo: next };
	}
};
