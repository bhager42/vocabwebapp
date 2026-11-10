import { requireParent } from '#lib/server/auth/guard.ts';
import { getDb } from '#lib/server/db/index.ts';
import { answersCsv } from '#lib/server/history.ts';
import { childFromParam } from '#lib/server/params.ts';
import { appTimeZone, localDayKey } from '#lib/server/time.ts';
import type { RequestHandler } from './$types';

/** Every answer the child has given, as a file to open in a spreadsheet. */
export const GET: RequestHandler = ({ locals, params }) => {
	requireParent(locals);
	const child = childFromParam(params.id);
	const timeZone = appTimeZone();

	// The file name is built from the id and the date only, never from the child's name,
	// so nothing typed by a person ends up in a header.
	const name = `vocab-answers-${child.id}-${localDayKey(new Date(), timeZone)}.csv`;
	// The byte order mark makes Excel read the file as UTF-8.
	return new Response('﻿' + answersCsv(getDb(), child.id, timeZone), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${name}"`
		}
	});
};
