// The weekly summary: what each child did in the past Monday-to-Sunday week, as figures
// and as the text and HTML of an email. See PLAN.md Phase 11.
//
// This module has no SvelteKit imports, so it can be used from unit tests.

import { and, eq, gte, lt } from 'drizzle-orm';
import { GRADES, listChildren } from './children.ts';
import type { Db } from './db/client.ts';
import { placementQuiz, wordProgress } from './db/schema.ts';
import { accuracy, sessionCounts, timePracticed, troubleWords, type Scope } from './metrics.ts';
import { gradeProgress, practicedDays, UNLOCK_SHARE } from './practice.ts';
import { formatDay, formatShortDay, localDayKey, shiftDayKey, startOfLocalDay } from './time.ts';

export interface Week {
	/** The Monday, `YYYY-MM-DD`. Also used as the week's key. */
	firstDay: string;
	/** The Sunday, `YYYY-MM-DD`. */
	lastDay: string;
	since: Date;
	until: Date;
}

/** Monday is 0, Sunday is 6. */
export function weekday(dayKey: string): number {
	return (new Date(`${dayKey}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The most recent full Monday-to-Sunday week before the one containing `now`. */
export function lastWeek(now: Date, timeZone: string): Week {
	const sinceMonday = weekday(localDayKey(now, timeZone));
	const firstDay = shiftDayKey(localDayKey(now, timeZone), -sinceMonday - 7);
	return {
		firstDay,
		lastDay: shiftDayKey(firstDay, 6),
		since: startOfLocalDay(now, timeZone, -sinceMonday - 7),
		until: startOfLocalDay(now, timeZone, -sinceMonday)
	};
}

export interface ChildWeek {
	name: string;
	grade: number;
	daysPracticed: number;
	minutes: number;
	sessionsCompleted: number;
	newWords: number;
	mastered: number;
	firstAttempts: number;
	/** 0 to 1, or null when nothing was answered. */
	accuracy: number | null;
	previousAccuracy: number | null;
	/** Up to three of the most-missed words, worst first. */
	troubleWords: string[];
	/** Share of the current grade's words known well, 0 to 1. */
	gradeProgress: number;
	/** The grade to offer when the 80% mark is reached and moving up is not automatic. */
	readyFor: number | null;
	/** The grade a placement quiz finished this week suggested. */
	quizGrade: number | null;
}

export interface WeeklySummary {
	week: Week;
	children: ChildWeek[];
}

function countBetween(
	db: Db,
	childId: number,
	column: typeof wordProgress.firstSeenAt | typeof wordProgress.masteredAt,
	week: Week
): number {
	return db
		.select({ wordId: wordProgress.wordId })
		.from(wordProgress)
		.where(and(eq(wordProgress.childId, childId), gte(column, week.since), lt(column, week.until)))
		.all().length;
}

export function weeklySummary(db: Db, now: Date, timeZone: string): WeeklySummary {
	const week = lastWeek(now, timeZone);
	const children = listChildren(db)
		.filter((child) => !child.archivedAt)
		.map((child): ChildWeek => {
			const scope: Scope = {
				childId: child.id,
				since: week.since,
				until: week.until,
				now,
				timeZone
			};
			const before: Scope = {
				...scope,
				since: startOfLocalDay(week.since, timeZone, -7),
				until: week.since
			};
			const days = [...practicedDays(db, child.id, timeZone)].filter(
				(day) => day >= week.firstDay && day <= week.lastDay
			);
			const thisWeek = accuracy(db, scope);
			const next = GRADES.find((grade) => grade > child.grade);
			const progress = gradeProgress(db, child.id, child.grade);
			const quiz = db
				.select({ grade: placementQuiz.resultGrade })
				.from(placementQuiz)
				.where(
					and(
						eq(placementQuiz.childId, child.id),
						eq(placementQuiz.completed, true),
						gte(placementQuiz.endedAt, week.since),
						lt(placementQuiz.endedAt, week.until)
					)
				)
				.all()
				.at(-1);

			return {
				name: child.name,
				grade: child.grade,
				daysPracticed: days.length,
				minutes: Math.round(timePracticed(db, scope) / 60_000),
				sessionsCompleted: sessionCounts(db, scope).completed,
				newWords: countBetween(db, child.id, wordProgress.firstSeenAt, week),
				mastered: countBetween(db, child.id, wordProgress.masteredAt, week),
				firstAttempts: thisWeek.firstAttempts,
				accuracy: thisWeek.share,
				previousAccuracy: accuracy(db, before).share,
				// Words from the lists, never what the child typed.
				troubleWords: troubleWords(db, scope, 3).map((entry) => entry.word),
				gradeProgress: progress,
				readyFor:
					next !== undefined && !child.settings.autoUnlockNextGrade && progress >= UNLOCK_SHARE
						? next
						: null,
				quizGrade: quiz?.grade ?? null
			};
		});
	return { week, children };
}

// ---- Turning it into an email ----

const percent = (share: number | null) => (share === null ? '–' : `${Math.round(share * 100)}%`);
const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

export function weekLabel(week: Week): string {
	return `${formatDay(week.firstDay)} to ${formatDay(week.lastDay)}`;
}

export function subject(summary: WeeklySummary): string {
	return `Vocab: the week of ${formatShortDay(summary.week.firstDay)}`;
}

/** The lines shown for one child, as label and value, in order. */
export function childLines(child: ChildWeek): [string, string][] {
	if (child.firstAttempts === 0 && child.daysPracticed === 0) return [];
	const lines: [string, string][] = [
		['Days practiced', `${child.daysPracticed} of 7`],
		['Time practiced', plural(child.minutes, 'minute')],
		['Sessions finished', String(child.sessionsCompleted)],
		['New words started', String(child.newWords)],
		['Words mastered', String(child.mastered)],
		['Accuracy', `${percent(child.accuracy)} (the week before: ${percent(child.previousAccuracy)})`]
	];
	if (child.troubleWords.length > 0) {
		lines.push(['Most missed', child.troubleWords.join(', ')]);
	}
	return lines;
}

/** Sentences after a child's figures: grade progress and anything to act on. */
export function childNotes(child: ChildWeek): string[] {
	const notes: string[] = [];
	if (child.firstAttempts === 0 && child.daysPracticed === 0) {
		notes.push(`${child.name} did not practice this week.`);
	}
	notes.push(`Grade ${child.grade} progress: ${percent(child.gradeProgress)} of words known well.`);
	if (child.readyFor !== null) {
		notes.push(
			`Ready to move up to grade ${child.readyFor}. You can do this on the Progress page.`
		);
	}
	if (child.quizGrade !== null) {
		notes.push(`A placement quiz this week suggested grade ${child.quizGrade}.`);
	}
	return notes;
}

export function renderText(summary: WeeklySummary, origin: string | undefined): string {
	const parts = [`Vocab: ${weekLabel(summary.week)}`, ''];
	if (summary.children.length === 0) parts.push('There are no children set up yet.', '');
	for (const child of summary.children) {
		parts.push(child.name, '-'.repeat(child.name.length));
		for (const [label, value] of childLines(child)) parts.push(`${label}: ${value}`);
		parts.push(...childNotes(child), '');
	}
	if (origin) parts.push(`See more: ${origin}/parent`, '');
	parts.push('To stop these emails, turn them off on the Account page in Vocab.');
	return parts.join('\n');
}

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

/** Makes text safe to put in HTML, as content or as a quoted attribute. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** A plain HTML email: no images, scripts, style sheets or remote resources. */
export function renderHtml(summary: WeeklySummary, origin: string | undefined): string {
	const e = escapeHtml;
	const cell = 'style="padding:4px 12px 4px 0;text-align:left;vertical-align:top"';
	const blocks = summary.children.map((child) => {
		const rows = childLines(child)
			.map(([label, value]) => `<tr><th ${cell}>${e(label)}</th><td ${cell}>${e(value)}</td></tr>`)
			.join('');
		const table = rows ? `<table style="border-collapse:collapse">${rows}</table>` : '';
		const notes = childNotes(child)
			.map((note) => `<p style="margin:8px 0">${e(note)}</p>`)
			.join('');
		return `<h2 style="font-size:18px;margin:24px 0 8px">${e(child.name)}</h2>${table}${notes}`;
	});
	const empty = summary.children.length === 0 ? '<p>There are no children set up yet.</p>' : '';
	const link = origin
		? `<p style="margin:24px 0 8px"><a href="${e(origin)}/parent">See more in Vocab</a></p>`
		: '';
	return [
		'<!doctype html><html lang="en"><head><meta charset="utf-8">',
		`<title>${e(subject(summary))}</title></head>`,
		'<body style="font-family:sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">',
		`<h1 style="font-size:20px">Vocab: ${e(weekLabel(summary.week))}</h1>`,
		...blocks,
		empty,
		link,
		'<p style="color:#555;font-size:13px">To stop these emails, turn them off on the Account page in Vocab.</p>',
		'</body></html>'
	].join('');
}
