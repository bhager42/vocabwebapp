import { requireParent } from '#lib/server/auth/guard.ts';
import { getDb } from '#lib/server/db/index.ts';
import { childLines, childNotes, weekLabel, weeklySummary } from '#lib/server/summary.ts';
import { appTimeZone } from '#lib/server/time.ts';
import type { PageServerLoad } from './$types';

// The weekly summary as the email would show it, whether or not email is set up.
export const load: PageServerLoad = ({ locals }) => {
	requireParent(locals);
	const summary = weeklySummary(getDb(), new Date(), appTimeZone());
	return {
		week: weekLabel(summary.week),
		children: summary.children.map((child) => ({
			name: child.name,
			lines: childLines(child),
			notes: childNotes(child)
		}))
	};
};
