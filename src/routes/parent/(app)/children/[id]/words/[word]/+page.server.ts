import { error } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { getDb } from '#lib/server/db/index.ts';
import { wordHistory } from '#lib/server/history.ts';
import { childFromParam, idParam } from '#lib/server/params.ts';
import { appTimeZone, formatDateTime, formatDay, localDayKey } from '#lib/server/time.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	requireParent(locals);
	const child = childFromParam(params.id);
	const history = wordHistory(getDb(), child.id, idParam(params.word));
	if (!history) error(404, 'Word not found');

	const timeZone = appTimeZone();
	const now = new Date();
	const { progress, answers, ...word } = history;

	return {
		word,
		progress: progress && {
			box: progress.box,
			stage: progress.stage,
			timesSeen: progress.timesSeen,
			timesCorrect: progress.timesCorrect,
			due: progress.dueAt <= now ? 'now' : `on ${formatDay(localDayKey(progress.dueAt, timeZone))}`
		},
		answers: answers.map(({ at, ...entry }) => ({ ...entry, when: formatDateTime(at, timeZone) }))
	};
};
