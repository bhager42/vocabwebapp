// Reading comprehension: a child reads a story and answers its questions one at a time.
// See PLAN.md Phase 12.
//
// Kept apart from word practice: it writes only to reading_attempt and reading_answer,
// so no word figure changes. Reading time does count toward the daily limit. As in
// practice, the correct answer stays on the server until the child has answered.

import { and, asc, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import { GRADES, type ChildSettings } from './children.ts';
import type { Db } from './db/client.ts';
import {
	child,
	readingAnswer,
	readingAttempt,
	readingQuestion,
	readingStory,
	type ReadingKind
} from './db/schema.ts';
import type { Scope } from './metrics.ts';
import { capReached } from './practice.ts';
import { shuffle, type Rng } from './questions.ts';

/**
 * Time between two actions counts as reading only up to this much. Longer than in word
 * practice (one minute), because reading the story before the first question takes a
 * few minutes.
 */
export const READING_GAP_CAP_MS = 5 * 60_000;
/** A story left untouched this long is closed unfinished. */
export const STALE_MS = 7 * 24 * 60 * 60_000;
/** The end-of-story page is shown for this long after finishing. */
const SUMMARY_WINDOW_MS = 60 * 60_000;

/** Moving up a reading grade: the last this many finished stories at the grade... */
export const MOVE_UP_STORIES = 5;
/** ...averaging this share right... */
export const MOVE_UP_SHARE = 0.8;
/** ...and at least this share right on inference questions. */
export const MOVE_UP_INFERENCE = 0.7;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Db | Tx;
type AttemptRow = typeof readingAttempt.$inferSelect;

export interface ReadingChild {
	id: number;
	readingGrade: number;
	settings: ChildSettings;
}

export interface Clock {
	now: Date;
	timeZone: string;
	rng: Rng;
}

// ---- Stories ----

/** Active questions of a story, in order. */
function questionsOf(db: Reader, storyId: number) {
	return db
		.select()
		.from(readingQuestion)
		.where(and(eq(readingQuestion.storyId, storyId), eq(readingQuestion.active, true)))
		.orderBy(asc(readingQuestion.position))
		.all();
}

/** Grades with at least one story switched on. */
export function readingGrades(db: Reader): number[] {
	const grades = new Set(
		db
			.select({ grade: readingStory.grade })
			.from(readingStory)
			.where(eq(readingStory.active, true))
			.all()
			.map((row) => row.grade)
	);
	return [...grades].sort((a, b) => a - b);
}

/**
 * The story to read next at a grade: the first one never finished, in content order;
 * once all have been finished, the one finished longest ago.
 */
export function nextStory(db: Reader, childId: number, grade: number): number | null {
	const stories = db
		.select({ id: readingStory.id })
		.from(readingStory)
		.where(and(eq(readingStory.grade, grade), eq(readingStory.active, true)))
		.orderBy(asc(readingStory.id))
		.all()
		.filter((story) => questionsOf(db, story.id).length > 0);
	if (stories.length === 0) return null;

	const lastFinished = new Map<number, number>();
	for (const attempt of db
		.select({ storyId: readingAttempt.storyId, endedAt: readingAttempt.endedAt })
		.from(readingAttempt)
		.where(and(eq(readingAttempt.childId, childId), eq(readingAttempt.completed, true)))
		.all()) {
		const at = attempt.endedAt?.getTime() ?? 0;
		lastFinished.set(attempt.storyId, Math.max(lastFinished.get(attempt.storyId) ?? 0, at));
	}

	const unread = stories.find((story) => !lastFinished.has(story.id));
	if (unread) return unread.id;
	return stories.reduce((oldest, story) =>
		lastFinished.get(story.id)! < lastFinished.get(oldest.id)! ? story : oldest
	).id;
}

// ---- Attempts ----

function answersOf(db: Reader, attemptId: number) {
	return db
		.select()
		.from(readingAnswer)
		.where(eq(readingAnswer.attemptId, attemptId))
		.orderBy(asc(readingAnswer.id))
		.all();
}

function lastTouched(attempt: AttemptRow, answers: ReturnType<typeof answersOf>): number {
	return answers.reduce(
		(latest, row) => Math.max(latest, (row.answeredAt ?? row.servedAt).getTime()),
		attempt.startedAt.getTime()
	);
}

/** The child's unfinished story, closing one left alone too long. */
function openAttempt(db: Reader, childId: number, now: Date): AttemptRow | null {
	const attempt = db
		.select()
		.from(readingAttempt)
		.where(and(eq(readingAttempt.childId, childId), isNull(readingAttempt.endedAt)))
		.orderBy(desc(readingAttempt.id))
		.get();
	if (!attempt) return null;
	const last = lastTouched(attempt, answersOf(db, attempt.id));
	if (now.getTime() - last < STALE_MS) return attempt;
	db.update(readingAttempt)
		.set({ endedAt: new Date(last) })
		.where(eq(readingAttempt.id, attempt.id))
		.run();
	return null;
}

/** Serves the next unasked question of the story. Returns false when none are left. */
function serveNext(tx: Tx, attempt: AttemptRow, clock: Clock): boolean {
	const asked = new Set(answersOf(tx, attempt.id).map((row) => row.questionId));
	const next = questionsOf(tx, attempt.storyId).find((entry) => !asked.has(entry.id));
	if (!next) return false;
	tx.insert(readingAnswer)
		.values({
			attemptId: attempt.id,
			questionId: next.id,
			choicesJson: shuffle([next.correct, ...next.wrongJson], clock.rng),
			correctChoice: next.correct,
			servedAt: clock.now
		})
		.run();
	return true;
}

export type ReadingStatus = 'ready' | 'resume' | 'capped' | 'none';

/** What the home page should offer for reading. */
export function readingStatus(
	db: Db,
	who: ReadingChild,
	now: Date,
	timeZone: string
): ReadingStatus {
	if (openAttempt(db, who.id, now)) return 'resume';
	if (nextStory(db, who.id, who.readingGrade) === null) return 'none';
	return capReached(db, who, now, timeZone) ? 'capped' : 'ready';
}

/** "Read a story" or "Keep reading". */
export function startReading(
	db: Db,
	who: ReadingChild,
	clock: Clock
): 'started' | 'resumed' | 'capped' | 'empty' {
	return db.transaction((tx) => {
		const open = openAttempt(tx, who.id, clock.now);
		if (open) {
			// A question is always waiting or answered; serve one if neither (an edge case
			// after a parent switched questions off).
			if (answersOf(tx, open.id).length === 0) serveNext(tx, open, clock);
			return 'resumed';
		}
		if (capReached(tx, who, clock.now, clock.timeZone)) return 'capped';
		const storyId = nextStory(tx, who.id, who.readingGrade);
		if (storyId === null) return 'empty';
		const attempt = tx
			.insert(readingAttempt)
			.values({ childId: who.id, storyId, startedAt: clock.now })
			.returning()
			.get();
		serveNext(tx, attempt, clock);
		return 'started';
	});
}

// ---- What the child sees ----

export interface StoryText {
	title: string;
	paragraphs: string[];
	/** The reading grade the story is written for, shown above the title. */
	grade: number;
}

export interface ReadingFeedback {
	correct: boolean;
	chosen: string;
	answer: string;
	explanation: string;
	choices: { text: string; state: 'correct' | 'incorrect' | 'dimmed' }[];
}

export type ReadingView =
	| { kind: 'none' }
	| {
			kind: 'question';
			story: StoryText;
			position: number;
			total: number;
			question: { id: number; prompt: string; choices: string[] };
	  }
	| {
			kind: 'feedback';
			story: StoryText;
			position: number;
			total: number;
			last: boolean;
			prompt: string;
			feedback: ReadingFeedback;
	  };

/** The current screen. While a question is unanswered, nothing says which choice is right. */
export function readingView(db: Db, childId: number, now: Date): ReadingView {
	return db.transaction((tx) => {
		const attempt = openAttempt(tx, childId, now);
		if (!attempt) return { kind: 'none' };
		const answers = answersOf(tx, attempt.id);
		const current = answers.at(-1);
		if (!current) return { kind: 'none' };

		const storyRow = tx
			.select()
			.from(readingStory)
			.where(eq(readingStory.id, attempt.storyId))
			.get()!;
		const story = {
			title: storyRow.title,
			paragraphs: storyRow.paragraphsJson,
			grade: storyRow.grade
		};
		const question = tx
			.select()
			.from(readingQuestion)
			.where(eq(readingQuestion.id, current.questionId))
			.get()!;
		const total = Math.max(questionsOf(tx, attempt.storyId).length, answers.length);
		const position = answers.length;

		if (current.chosen === null) {
			return {
				kind: 'question',
				story,
				position,
				total,
				question: { id: current.id, prompt: question.prompt, choices: current.choicesJson }
			};
		}
		return {
			kind: 'feedback',
			story,
			position,
			total,
			last: position >= total,
			prompt: question.prompt,
			feedback: {
				correct: current.isCorrect === true,
				chosen: current.chosen,
				answer: current.correctChoice,
				explanation: question.explanation,
				choices: current.choicesJson.map((text) => ({
					text,
					state:
						text === current.correctChoice
							? 'correct'
							: text === current.chosen
								? 'incorrect'
								: 'dimmed'
				}))
			}
		};
	});
}

// ---- Answering and moving on ----

export interface ReadingAnswerInput {
	/** The reading_answer row of the question on screen. */
	questionId: number;
	choice?: number;
	responseMs?: number;
}

/**
 * - recorded: checked and saved.
 * - stale: not the question waiting for an answer (double click, Back, or not this
 *   child's). Nothing is changed.
 * - invalid: no answer was given. Nothing is changed.
 */
export function answerReading(
	db: Db,
	childId: number,
	input: ReadingAnswerInput,
	now: Date
): 'recorded' | 'stale' | 'invalid' {
	return db.transaction((tx) => {
		// Only the signed-in child's own story is ever looked at.
		const attempt = openAttempt(tx, childId, now);
		if (!attempt) return 'stale';
		const current = answersOf(tx, attempt.id).at(-1);
		if (!current || current.id !== input.questionId || current.chosen !== null) return 'stale';

		const chosen = input.choice === undefined ? undefined : current.choicesJson[input.choice];
		if (chosen === undefined) return 'invalid';

		const elapsed = Math.max(0, now.getTime() - current.servedAt.getTime());
		const measured = input.responseMs;
		const responseMs =
			measured !== undefined &&
			Number.isFinite(measured) &&
			measured >= 0 &&
			measured <= elapsed + 1000
				? Math.round(measured)
				: elapsed;

		tx.update(readingAnswer)
			.set({ chosen, isCorrect: chosen === current.correctChoice, responseMs, answeredAt: now })
			.where(eq(readingAnswer.id, current.id))
			.run();
		tx.update(readingAttempt)
			.set({ activeMs: attempt.activeMs + Math.min(elapsed, READING_GAP_CAP_MS) })
			.where(eq(readingAttempt.id, attempt.id))
			.run();
		return 'recorded';
	});
}

/**
 * "Next" on the feedback screen.
 * - question: the next question is on screen.
 * - done: the story is finished.
 * - waiting: a question is still to be answered, so nothing was done.
 * - none: there is no story open.
 */
export function advanceReading(
	db: Db,
	who: ReadingChild,
	clock: Clock
): 'question' | 'done' | 'waiting' | 'none' {
	const { now } = clock;
	return db.transaction((tx) => {
		const attempt = openAttempt(tx, who.id, now);
		if (!attempt) return 'none';
		const current = answersOf(tx, attempt.id).at(-1);
		if (current && !current.answeredAt) return 'waiting';

		const reading = current?.answeredAt
			? Math.max(0, now.getTime() - current.answeredAt.getTime())
			: 0;
		const updated = {
			...attempt,
			activeMs: attempt.activeMs + Math.min(reading, READING_GAP_CAP_MS)
		};
		tx.update(readingAttempt)
			.set({ activeMs: updated.activeMs })
			.where(eq(readingAttempt.id, attempt.id))
			.run();

		if (serveNext(tx, updated, clock)) return 'question';

		tx.update(readingAttempt)
			.set({ endedAt: now, completed: true })
			.where(eq(readingAttempt.id, attempt.id))
			.run();
		// Move up a reading grade when ready, if the parent chose "automatic".
		const next = nextReadingGrade(tx, who.readingGrade);
		if (
			next !== null &&
			who.settings.autoUnlockReadingGrade &&
			readiness(tx, who.id, who.readingGrade).ready
		) {
			tx.update(child).set({ readingGrade: next }).where(eq(child.id, who.id)).run();
		}
		return 'done';
	});
}

export interface ReadingSummary {
	title: string;
	right: number;
	total: number;
	canReadAgain: boolean;
}

/** The story the child has just finished, for the "Well done" page. */
export function lastReadingSummary(
	db: Db,
	who: ReadingChild,
	now: Date,
	timeZone: string
): ReadingSummary | null {
	const attempt = db
		.select()
		.from(readingAttempt)
		.where(and(eq(readingAttempt.childId, who.id), eq(readingAttempt.completed, true)))
		.orderBy(desc(readingAttempt.endedAt))
		.get();
	if (!attempt?.endedAt || now.getTime() - attempt.endedAt.getTime() > SUMMARY_WINDOW_MS) {
		return null;
	}
	const answers = answersOf(db, attempt.id);
	const title = db
		.select({ title: readingStory.title })
		.from(readingStory)
		.where(eq(readingStory.id, attempt.storyId))
		.get()!.title;
	return {
		title,
		right: answers.filter((row) => row.isCorrect).length,
		total: answers.length,
		canReadAgain: !capReached(db, who, now, timeZone)
	};
}

// ---- Reading grade ----

/** The next grade up that has stories, or null at the top. */
export function nextReadingGrade(db: Reader, grade: number): number | null {
	const available = readingGrades(db);
	return GRADES.find((entry) => entry > grade && available.includes(entry)) ?? null;
}

export interface Readiness {
	/** Finished stories at the grade counted (at most MOVE_UP_STORIES, newest first). */
	stories: number;
	share: number | null;
	inferenceShare: number | null;
	ready: boolean;
}

/** Whether the child's last few stories at a grade show they are ready for the next. */
export function readiness(db: Reader, childId: number, grade: number): Readiness {
	const attempts = db
		.select({ id: readingAttempt.id })
		.from(readingAttempt)
		.innerJoin(readingStory, eq(readingStory.id, readingAttempt.storyId))
		.where(
			and(
				eq(readingAttempt.childId, childId),
				eq(readingAttempt.completed, true),
				eq(readingStory.grade, grade)
			)
		)
		.orderBy(desc(readingAttempt.endedAt), desc(readingAttempt.id))
		.limit(MOVE_UP_STORIES)
		.all();

	const rows = attempts.flatMap((attempt) => answerKinds(db, attempt.id));
	const tally = (list: typeof rows) =>
		list.length === 0 ? null : list.filter((row) => row.isCorrect).length / list.length;
	const share = tally(rows);
	const inferenceShare = tally(rows.filter((row) => row.kind === 'inference'));
	return {
		stories: attempts.length,
		share,
		inferenceShare,
		ready:
			attempts.length >= MOVE_UP_STORIES &&
			(share ?? 0) >= MOVE_UP_SHARE &&
			(inferenceShare ?? 0) >= MOVE_UP_INFERENCE
	};
}

function answerKinds(db: Reader, attemptId: number) {
	return db
		.select({ kind: readingQuestion.kind, isCorrect: readingAnswer.isCorrect })
		.from(readingAnswer)
		.innerJoin(readingQuestion, eq(readingQuestion.id, readingAnswer.questionId))
		.where(eq(readingAnswer.attemptId, attemptId))
		.all()
		.filter((row): row is { kind: ReadingKind; isCorrect: boolean } => row.isCorrect !== null);
}

// ---- For the parent ----

export interface KindAccuracy {
	asked: number;
	correct: number;
	share: number | null;
}

export interface ReadingFigures {
	started: number;
	finished: number;
	minutes: number;
	overall: KindAccuracy;
	/** Answers stated in the story. */
	literal: KindAccuracy;
	/** Answers that had to be worked out. */
	inference: KindAccuracy;
	/** Word meaning, main idea and order of events. */
	other: KindAccuracy;
}

const accuracyOf = (rows: { isCorrect: boolean }[]): KindAccuracy => {
	const correct = rows.filter((row) => row.isCorrect).length;
	return { asked: rows.length, correct, share: rows.length ? correct / rows.length : null };
};

function attemptsIn(db: Reader, scope: Scope) {
	return db
		.select()
		.from(readingAttempt)
		.where(
			and(
				eq(readingAttempt.childId, scope.childId),
				scope.since ? gte(readingAttempt.startedAt, scope.since) : undefined,
				scope.until ? lt(readingAttempt.startedAt, scope.until) : undefined
			)
		)
		.all();
}

/** Reading figures for a child over a stretch of time (by when each story was started). */
export function readingFigures(db: Reader, scope: Scope): ReadingFigures {
	const attempts = attemptsIn(db, scope);
	const rows = attempts.flatMap((attempt) => answerKinds(db, attempt.id));
	return {
		started: attempts.length,
		finished: attempts.filter((attempt) => attempt.completed).length,
		minutes: Math.round(attempts.reduce((total, attempt) => total + attempt.activeMs, 0) / 60_000),
		overall: accuracyOf(rows),
		literal: accuracyOf(rows.filter((row) => row.kind === 'literal')),
		inference: accuracyOf(rows.filter((row) => row.kind === 'inference')),
		other: accuracyOf(rows.filter((row) => row.kind !== 'literal' && row.kind !== 'inference'))
	};
}

export interface GradeCompletion {
	grade: number;
	/** Stories switched on at the grade. */
	stories: number;
	/** Of those, how many the child has finished at least once. */
	finished: number;
	/** Answers in the child's finished readings of stories at the grade. */
	right: KindAccuracy;
}

/** For every grade that has stories: how many the child has finished, and how well. */
export function storiesByGrade(db: Reader, childId: number): GradeCompletion[] {
	const stories = db
		.select({ id: readingStory.id, grade: readingStory.grade })
		.from(readingStory)
		.where(eq(readingStory.active, true))
		.all();
	const finishedAttempts = db
		.select({ id: readingAttempt.id, storyId: readingAttempt.storyId })
		.from(readingAttempt)
		.where(and(eq(readingAttempt.childId, childId), eq(readingAttempt.completed, true)))
		.all();
	const gradeOf = new Map(stories.map((story) => [story.id, story.grade]));

	return readingGrades(db).map((grade) => {
		const attempts = finishedAttempts.filter((attempt) => gradeOf.get(attempt.storyId) === grade);
		return {
			grade,
			stories: stories.filter((story) => story.grade === grade).length,
			finished: new Set(attempts.map((attempt) => attempt.storyId)).size,
			right: accuracyOf(attempts.flatMap((attempt) => answerKinds(db, attempt.id)))
		};
	});
}

export interface AttemptSummary {
	id: number;
	title: string;
	grade: number;
	startedAt: Date;
	endedAt: Date | null;
	state: 'open' | 'finished' | 'unfinished';
	right: number;
	answered: number;
	total: number;
}

/** Every story the child has started, newest first. */
export function listAttempts(db: Db, childId: number, now: Date): AttemptSummary[] {
	openAttempt(db, childId, now); // close a stale one first, so its state is right
	return db
		.select({ attempt: readingAttempt, title: readingStory.title, grade: readingStory.grade })
		.from(readingAttempt)
		.innerJoin(readingStory, eq(readingStory.id, readingAttempt.storyId))
		.where(eq(readingAttempt.childId, childId))
		.orderBy(desc(readingAttempt.startedAt), desc(readingAttempt.id))
		.all()
		.map(({ attempt, title, grade }) => {
			const answers = answersOf(db, attempt.id);
			const answered = answers.filter((row) => row.chosen !== null);
			return {
				id: attempt.id,
				title,
				grade,
				startedAt: attempt.startedAt,
				endedAt: attempt.endedAt,
				state: !attempt.endedAt ? 'open' : attempt.completed ? 'finished' : 'unfinished',
				right: answered.filter((row) => row.isCorrect).length,
				answered: answered.length,
				total: questionsOf(db, attempt.storyId).length
			};
		});
}

export interface AttemptDetail {
	id: number;
	story: StoryText;
	startedAt: Date;
	state: AttemptSummary['state'];
	answers: {
		kind: ReadingKind;
		prompt: string;
		chosen: string | null;
		correct: string;
		isCorrect: boolean | null;
		explanation: string;
	}[];
}

/** One attempt with every answer, for the parent. Null if it is not this child's. */
export function attemptDetail(db: Db, childId: number, attemptId: number): AttemptDetail | null {
	const attempt = db
		.select()
		.from(readingAttempt)
		.where(and(eq(readingAttempt.id, attemptId), eq(readingAttempt.childId, childId)))
		.get();
	if (!attempt) return null;
	const story = db.select().from(readingStory).where(eq(readingStory.id, attempt.storyId)).get()!;
	const answers = db
		.select({ answer: readingAnswer, question: readingQuestion })
		.from(readingAnswer)
		.innerJoin(readingQuestion, eq(readingQuestion.id, readingAnswer.questionId))
		.where(eq(readingAnswer.attemptId, attempt.id))
		.orderBy(asc(readingAnswer.id))
		.all();
	return {
		id: attempt.id,
		story: { title: story.title, paragraphs: story.paragraphsJson, grade: story.grade },
		startedAt: attempt.startedAt,
		state: !attempt.endedAt ? 'open' : attempt.completed ? 'finished' : 'unfinished',
		answers: answers.map(({ answer, question }) => ({
			kind: question.kind,
			prompt: question.prompt,
			chosen: answer.chosen,
			correct: answer.correctChoice,
			isCorrect: answer.isCorrect,
			explanation: question.explanation
		}))
	};
}

// ---- Story lists ----

export interface StoryRow {
	id: number;
	slug: string;
	grade: number;
	title: string;
	active: boolean;
	words: number;
	paragraphs: string[];
	questions: { kind: ReadingKind; prompt: string; correct: string; wrong: string[] }[];
}

/** Every story with its questions, for the parent to review and switch on or off. */
export function listStories(db: Db): StoryRow[] {
	return db
		.select()
		.from(readingStory)
		.orderBy(asc(readingStory.grade), asc(readingStory.id))
		.all()
		.map((row) => ({
			id: row.id,
			slug: row.slug,
			grade: row.grade,
			title: row.title,
			active: row.active,
			words: row.paragraphsJson.join(' ').split(/\s+/).filter(Boolean).length,
			paragraphs: row.paragraphsJson,
			questions: questionsOf(db, row.id).map((entry) => ({
				kind: entry.kind,
				prompt: entry.prompt,
				correct: entry.correct,
				wrong: entry.wrongJson
			}))
		}));
}

export function setStoryActive(db: Db, id: number, active: boolean): boolean {
	return db.update(readingStory).set({ active }).where(eq(readingStory.id, id)).run().changes > 0;
}
