// What the parent dashboard shows about a child's practice. See PLAN.md section 5.
//
// There is one function per metric. Each reads only the tables practice already writes
// (answer, question, practice_session, word_progress), so nothing extra is tracked.
//
// Two words used throughout:
// - A "first attempt" is the first time a word is asked in a session. Later asks of the
//   same word in that session (a retry after a miss, or a second look that fills out a
//   short session) are easier, so accuracy figures leave them out unless they say otherwise.
// - A "scope" is one child and a stretch of time ending now.

import { and, asc, eq, gte } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import {
	answer,
	practiceSession,
	question,
	QUESTION_TYPES,
	word,
	wordList,
	wordProgress,
	type QuestionType
} from './db/schema.ts';
import { lastActivity, practicedDays, RESUME_WINDOW_MS } from './practice.ts';
import {
	currentStreak,
	dayKeysBetween,
	localDayKey,
	localHour,
	longestStreak,
	shiftDayKey,
	startOfLocalDay
} from './time.ts';

export const PERIODS = ['7d', '30d', 'all'] as const;
export type Period = (typeof PERIODS)[number];

export interface Scope {
	childId: number;
	/** Start of the stretch of time, or null for everything. */
	since: Date | null;
	now: Date;
	timeZone: string;
}

/** "7d" means today and the six days before it, by the calendar in the app's time zone. */
export function scopeFor(childId: number, period: Period, now: Date, timeZone: string): Scope {
	const days = period === '7d' ? 7 : period === '30d' ? 30 : null;
	return {
		childId,
		since: days === null ? null : startOfLocalDay(now, timeZone, -(days - 1)),
		now,
		timeZone
	};
}

/** A wrong answer faster than this was probably a guess. */
export const GUESS_MS = 1500;
/** A word counts toward retention when it was last seen at least this long before. */
export const RETENTION_GAP_MS = 7 * 24 * 60 * 60_000;
/** "Best time of day" is only named once there is this much to go on. */
export const HOURS_MIN_TOTAL = 50;
export const HOURS_MIN_PER_HOUR = 10;

const share = (part: number, whole: number) => (whole === 0 ? null : part / whole);

// ---- Reading ----

interface AnswerRow {
	sessionId: number;
	wordId: number;
	type: QuestionType;
	chosen: string;
	isCorrect: boolean;
	responseMs: number;
	isRetry: boolean;
	answeredAt: Date;
}

/** The child's answers, oldest first. `since` null means all of them. */
function answers(db: Db, childId: number, since: Date | null): AnswerRow[] {
	return db
		.select({
			sessionId: question.practiceSessionId,
			wordId: question.wordId,
			type: question.type,
			chosen: answer.chosen,
			isCorrect: answer.isCorrect,
			responseMs: answer.responseMs,
			isRetry: answer.isRetry,
			answeredAt: answer.answeredAt
		})
		.from(answer)
		.innerJoin(question, eq(question.id, answer.questionId))
		.innerJoin(practiceSession, eq(practiceSession.id, question.practiceSessionId))
		.where(
			and(eq(practiceSession.childId, childId), since ? gte(answer.answeredAt, since) : undefined)
		)
		.orderBy(asc(answer.answeredAt), asc(question.id))
		.all();
}

function sessions(db: Db, { childId, since }: Scope) {
	return db
		.select()
		.from(practiceSession)
		.where(
			and(
				eq(practiceSession.childId, childId),
				since ? gte(practiceSession.startedAt, since) : undefined
			)
		)
		.orderBy(asc(practiceSession.startedAt))
		.all();
}

// ---- Accuracy ----

export interface Accuracy {
	firstAttempts: number;
	firstCorrect: number;
	/** Correct first attempts ÷ first attempts, 0 to 1. Null when nothing was answered. */
	share: number | null;
	/** Later asks of a word in the same session, counted apart. */
	retries: number;
	retriesCorrect: number;
}

export function accuracy(db: Db, scope: Scope): Accuracy {
	const rows = answers(db, scope.childId, scope.since);
	const first = rows.filter((row) => !row.isRetry);
	const retries = rows.filter((row) => row.isRetry);
	const firstCorrect = first.filter((row) => row.isCorrect).length;
	return {
		firstAttempts: first.length,
		firstCorrect,
		share: share(firstCorrect, first.length),
		retries: retries.length,
		retriesCorrect: retries.filter((row) => row.isCorrect).length
	};
}

// ---- Day by day ----

export interface DayActivity {
	/** Local date, `YYYY-MM-DD`. */
	day: string;
	firstAttempts: number;
	firstCorrect: number;
	/** Null on a day without practice. */
	accuracy: number | null;
	/** Active time of the sessions started that day. */
	activeMs: number;
	sessions: number;
}

/**
 * One entry per calendar day, days without practice included, up to today. For "all
 * time" the first entry is the day of the first session; with no practice it is empty.
 */
export function dailyActivity(db: Db, scope: Scope): DayActivity[] {
	const { since, now, timeZone } = scope;
	const rows = answers(db, scope.childId, since);
	const sessionRows = sessions(db, scope);

	const today = localDayKey(now, timeZone);
	const first = since
		? localDayKey(since, timeZone)
		: sessionRows.length > 0
			? localDayKey(sessionRows[0].startedAt, timeZone)
			: null;
	if (first === null) return [];

	const days = new Map<string, DayActivity>(
		dayKeysBetween(first, today).map((day) => [
			day,
			{ day, firstAttempts: 0, firstCorrect: 0, accuracy: null, activeMs: 0, sessions: 0 }
		])
	);

	for (const row of rows) {
		const entry = days.get(localDayKey(row.answeredAt, timeZone));
		if (!entry || row.isRetry) continue;
		entry.firstAttempts++;
		if (row.isCorrect) entry.firstCorrect++;
	}
	for (const session of sessionRows) {
		const entry = days.get(localDayKey(session.startedAt, timeZone));
		if (!entry) continue;
		entry.activeMs += session.activeMs;
		entry.sessions++;
	}
	for (const entry of days.values()) {
		entry.accuracy = share(entry.firstCorrect, entry.firstAttempts);
	}
	return [...days.values()];
}

/** Adds days up into weeks (Monday to Sunday), for charts that cover a long time. */
export function groupByWeek(days: DayActivity[]): DayActivity[] {
	const weeks = new Map<string, DayActivity>();
	for (const entry of days) {
		// 1970-01-01 was a Thursday, so day number + 3 is a multiple of 7 on Mondays.
		const dayNumber = Math.round(Date.parse(`${entry.day}T00:00:00Z`) / 86_400_000);
		const monday = shiftDayKey(entry.day, -((((dayNumber + 3) % 7) + 7) % 7));
		const week = weeks.get(monday) ?? {
			day: monday,
			firstAttempts: 0,
			firstCorrect: 0,
			accuracy: null,
			activeMs: 0,
			sessions: 0
		};
		week.firstAttempts += entry.firstAttempts;
		week.firstCorrect += entry.firstCorrect;
		week.activeMs += entry.activeMs;
		week.sessions += entry.sessions;
		week.accuracy = share(week.firstCorrect, week.firstAttempts);
		weeks.set(monday, week);
	}
	return [...weeks.values()];
}

// ---- Time ----

/**
 * Milliseconds of active practice. Active time is not time on the clock: it is the sum
 * of the gaps between one action and the next, each counted only up to a minute
 * (practice.ts adds it up as the child goes), so a tablet left on a question adds little.
 */
export function timePracticed(db: Db, scope: Scope): number {
	return sessions(db, scope).reduce((total, session) => total + session.activeMs, 0);
}

// ---- Days and streaks ----

export interface PracticeDays {
	/** Days in the scope with at least one finished session. */
	daysPracticed: number;
	/** Days in a row up to today (or yesterday, if today has no practice yet). */
	currentStreak: number;
	/** The longest run ever, whatever the scope. */
	longestStreak: number;
	/** The most recent day with a finished session, `YYYY-MM-DD`, if any. */
	lastDay: string | null;
}

export function practiceDays(db: Db, scope: Scope): PracticeDays {
	const { childId, since, now, timeZone } = scope;
	const days = practicedDays(db, childId, timeZone);
	const from = since ? localDayKey(since, timeZone) : '';
	const sorted = [...days].sort();
	return {
		daysPracticed: sorted.filter((day) => day >= from).length,
		currentStreak: currentStreak(days, localDayKey(now, timeZone)),
		longestStreak: longestStreak(days),
		lastDay: sorted.at(-1) ?? null
	};
}

// ---- Sessions ----

export interface SessionCounts {
	started: number;
	/** Every planned question was answered. */
	completed: number;
	/** Stopped early, or walked away from. */
	abandoned: number;
	/** Open right now: the child could still carry on with it. */
	inProgress: number;
}

export function sessionCounts(db: Db, scope: Scope): SessionCounts {
	const rows = sessions(db, scope);
	const completed = rows.filter((row) => row.completed).length;
	// A session that was walked away from is only marked as ended the next time the child
	// comes back, so an open one counts as in progress only while it can still be resumed.
	const inProgress = rows.filter(
		(row) =>
			!row.endedAt && scope.now.getTime() - lastActivity(db, row).getTime() < RESUME_WINDOW_MS
	).length;
	return {
		started: rows.length,
		completed,
		abandoned: rows.length - completed - inProgress,
		inProgress
	};
}

// ---- Words ----

export interface GradeStatus {
	grade: number;
	total: number;
	/** Not asked yet. */
	fresh: number;
	/** Boxes 1 to 3. */
	learning: number;
	/** Boxes 4 and 5, not yet mastered. */
	almost: number;
	mastered: number;
	/** Share of the grade's words at box 4 or above, 0 to 1. This is "grade progress". */
	known: number;
}

/**
 * Where the child stands with each grade's words. Only words that can be asked are
 * counted (active words in active lists). Grades above `upToGrade` are left out unless
 * the child has already met some of their words.
 */
export function wordStatus(db: Db, childId: number, upToGrade: number): GradeStatus[] {
	const rows = db
		.select({
			grade: wordList.grade,
			box: wordProgress.box,
			masteredAt: wordProgress.masteredAt
		})
		.from(word)
		.innerJoin(wordList, eq(wordList.id, word.listId))
		.leftJoin(
			wordProgress,
			and(eq(wordProgress.wordId, word.id), eq(wordProgress.childId, childId))
		)
		.where(and(eq(word.active, true), eq(wordList.active, true)))
		.all();

	const grades = new Map<number, GradeStatus>();
	for (const row of rows) {
		const status = grades.get(row.grade) ?? {
			grade: row.grade,
			total: 0,
			fresh: 0,
			learning: 0,
			almost: 0,
			mastered: 0,
			known: 0
		};
		status.total++;
		if (row.box === null) status.fresh++;
		else if (row.masteredAt) status.mastered++;
		else if (row.box >= 4) status.almost++;
		else status.learning++;
		grades.set(row.grade, status);
	}

	return [...grades.values()]
		.filter((status) => status.grade <= upToGrade || status.fresh < status.total)
		.map((status) => ({ ...status, known: (status.almost + status.mastered) / status.total }))
		.sort((a, b) => a.grade - b.grade);
}

export interface TroubleWord {
	wordId: number;
	word: string;
	definition: string;
	/** Times asked in the scope, every ask counted. */
	asked: number;
	wrong: number;
	/**
	 * The wrong answer given most often. Where that answer was another word's definition,
	 * this is that word, so it always reads as "mixed up with ...".
	 */
	confusedWith: string | null;
	confusedTimes: number;
}

/** The words missed most often, worst first. Words never missed are left out. */
export function troubleWords(db: Db, scope: Scope, limit = 10): TroubleWord[] {
	const rows = answers(db, scope.childId, scope.since);
	const words = db
		.select({ id: word.id, word: word.word, definition: word.definition })
		.from(word)
		.all();
	const byId = new Map(words.map((entry) => [entry.id, entry]));
	const byDefinition = new Map(words.map((entry) => [entry.definition, entry.word]));

	const tally = new Map<number, { asked: number; wrong: number; picks: Map<string, number> }>();
	for (const row of rows) {
		const entry = tally.get(row.wordId) ?? { asked: 0, wrong: 0, picks: new Map() };
		entry.asked++;
		if (!row.isCorrect) {
			entry.wrong++;
			const pick = byDefinition.get(row.chosen) ?? row.chosen;
			entry.picks.set(pick, (entry.picks.get(pick) ?? 0) + 1);
		}
		tally.set(row.wordId, entry);
	}

	return [...tally]
		.filter(([, entry]) => entry.wrong > 0)
		.map(([wordId, entry]) => {
			// The most frequent wrong answer; ties go to the one given first.
			const [confusedWith, confusedTimes] = [...entry.picks].reduce((best, pick) =>
				pick[1] > best[1] ? pick : best
			);
			const info = byId.get(wordId)!;
			return {
				wordId,
				word: info.word,
				definition: info.definition,
				asked: entry.asked,
				wrong: entry.wrong,
				confusedWith,
				confusedTimes
			};
		})
		.sort(
			(a, b) =>
				b.wrong - a.wrong || b.wrong / b.asked - a.wrong / a.asked || a.word.localeCompare(b.word)
		)
		.slice(0, limit);
}

// ---- Retention ----

export interface Retention {
	/** First attempts in the scope at words last seen 7 or more days before. */
	asked: number;
	correct: number;
	share: number | null;
}

/** Is it sticking? Accuracy on words that had not been seen for a week or more. */
export function retention(db: Db, scope: Scope): Retention {
	// Everything is read, not just the scope, to know when each word was seen before.
	const rows = answers(db, scope.childId, null);
	const lastSeen = new Map<number, number>();
	let asked = 0;
	let correct = 0;

	for (const row of rows) {
		const at = row.answeredAt.getTime();
		const before = lastSeen.get(row.wordId);
		const inScope = !scope.since || at >= scope.since.getTime();
		if (inScope && !row.isRetry && before !== undefined && at - before >= RETENTION_GAP_MS) {
			asked++;
			if (row.isCorrect) correct++;
		}
		lastSeen.set(row.wordId, at);
	}
	return { asked, correct, share: share(correct, asked) };
}

// ---- By kind of question ----

export interface TypeAccuracy {
	type: QuestionType;
	firstAttempts: number;
	firstCorrect: number;
	share: number | null;
}

/** Accuracy on first attempts for each kind of question, in the order they are learned. */
export function accuracyByType(db: Db, scope: Scope): TypeAccuracy[] {
	const first = answers(db, scope.childId, scope.since).filter((row) => !row.isRetry);
	return QUESTION_TYPES.map((type) => {
		const ofType = first.filter((row) => row.type === type);
		const firstCorrect = ofType.filter((row) => row.isCorrect).length;
		return {
			type,
			firstAttempts: ofType.length,
			firstCorrect,
			share: share(firstCorrect, ofType.length)
		};
	});
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface ResponseTimes {
	/** Median thinking time over every answer, in milliseconds. */
	overallMs: number | null;
	byType: { type: QuestionType; answers: number; medianMs: number | null }[];
}

/** Median time from seeing a question to answering it. Every answer counts, retries too. */
export function responseTimes(db: Db, scope: Scope): ResponseTimes {
	const rows = answers(db, scope.childId, scope.since);
	return {
		overallMs: median(rows.map((row) => row.responseMs)),
		byType: QUESTION_TYPES.map((type) => {
			const times = rows.filter((row) => row.type === type).map((row) => row.responseMs);
			return { type, answers: times.length, medianMs: median(times) };
		})
	};
}

// ---- Guessing ----

export interface Guessing {
	wrong: number;
	/** Wrong answers given in under a second and a half. */
	fastWrong: number;
	share: number | null;
}

/**
 * How many wrong answers came too fast to have been read. Spelling questions are left
 * out: nobody types a word that quickly, so they would only water the figure down.
 */
export function guessing(db: Db, scope: Scope): Guessing {
	const wrong = answers(db, scope.childId, scope.since).filter(
		(row) => !row.isCorrect && row.type !== 'spell'
	);
	const fastWrong = wrong.filter((row) => row.responseMs < GUESS_MS).length;
	return { wrong: wrong.length, fastWrong, share: share(fastWrong, wrong.length) };
}

// ---- Time of day ----

export interface HourAccuracy {
	/** Hour of the day on the app's clock, 0 to 23. */
	hour: number;
	firstAttempts: number;
	firstCorrect: number;
	share: number;
}

export interface TimeOfDay {
	/** Hours with at least one first attempt, earliest first. */
	hours: HourAccuracy[];
	/**
	 * The hour with the best accuracy, or null until there is enough to go on: 50 first
	 * attempts in all, and at least two hours with 10 each to compare.
	 */
	best: HourAccuracy | null;
}

export function timeOfDay(db: Db, scope: Scope): TimeOfDay {
	const first = answers(db, scope.childId, scope.since).filter((row) => !row.isRetry);
	const tally = new Map<number, { firstAttempts: number; firstCorrect: number }>();
	for (const row of first) {
		const hour = localHour(row.answeredAt, scope.timeZone);
		const entry = tally.get(hour) ?? { firstAttempts: 0, firstCorrect: 0 };
		entry.firstAttempts++;
		if (row.isCorrect) entry.firstCorrect++;
		tally.set(hour, entry);
	}

	const hours = [...tally]
		.map(([hour, entry]) => ({ hour, ...entry, share: entry.firstCorrect / entry.firstAttempts }))
		.sort((a, b) => a.hour - b.hour);

	const comparable = hours.filter((entry) => entry.firstAttempts >= HOURS_MIN_PER_HOUR);
	const enough = first.length >= HOURS_MIN_TOTAL && comparable.length >= 2;
	return {
		hours,
		// Ties go to the hour with more answers behind it.
		best: enough
			? comparable.reduce((best, entry) =>
					entry.share > best.share ||
					(entry.share === best.share && entry.firstAttempts > best.firstAttempts)
						? entry
						: best
				)
			: null
	};
}
