// A child's practice session: starting it, serving questions, checking answers and
// finishing. This is the only module that writes practice data. The decisions themselves
// (which box, which questions, which wrong choices) are made by the pure modules
// srs.ts and questions.ts.

import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { GRADES, type ChildSettings } from './children.ts';
import type { Db } from './db/client.ts';
import {
	answer,
	child,
	practiceSession,
	question,
	word,
	wordList,
	wordProgress,
	type PlanItem
} from './db/schema.ts';
import {
	buildQuestion,
	composePlan,
	isCorrect,
	publicQuestion,
	shuffle,
	SPELLING_MAX_LENGTH,
	withRetry,
	type PublicQuestion,
	type QuestionType,
	type Rng,
	type WordInfo
} from './questions.ts';
import { applyAnswer } from './srs.ts';
import { currentStreak, localDayKey, startOfLocalDay } from './time.ts';

/** A session left alone for this long is closed; the child starts a fresh one next time. */
export const RESUME_WINDOW_MS = 60 * 60_000;
/** Time between two actions counts as practice only up to this much. See PLAN.md section 5. */
export const ACTIVE_GAP_CAP_MS = 60_000;
/** The end-of-session page is shown for this long after finishing. */
const SUMMARY_WINDOW_MS = 60 * 60_000;
/** Share of a grade's words at box 4 or above that unlocks the next grade. */
export const UNLOCK_SHARE = 0.8;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Db | Tx;
type SessionRow = typeof practiceSession.$inferSelect;

export interface PracticeChild {
	id: number;
	grade: number;
	settings: ChildSettings;
}

export interface Clock {
	now: Date;
	timeZone: string;
	rng: Rng;
}

// ---- Words ----

/** Every word that may be asked: active, and in an active list. */
function eligibleWords(db: Reader): WordInfo[] {
	return db
		.select({
			id: word.id,
			listId: word.listId,
			grade: wordList.grade,
			word: word.word,
			partOfSpeech: word.partOfSpeech,
			definition: word.definition,
			sentence: word.sentence,
			synonyms: word.synonymsJson
		})
		.from(word)
		.innerJoin(wordList, eq(wordList.id, word.listId))
		.where(and(eq(word.active, true), eq(wordList.active, true)))
		.all();
}

function wordInfo(db: Reader, id: number): WordInfo {
	return db
		.select({
			id: word.id,
			listId: word.listId,
			grade: wordList.grade,
			word: word.word,
			partOfSpeech: word.partOfSpeech,
			definition: word.definition,
			sentence: word.sentence,
			synonyms: word.synonymsJson
		})
		.from(word)
		.innerJoin(wordList, eq(wordList.id, word.listId))
		.where(eq(word.id, id))
		.get()!;
}

// ---- Sessions ----

function lastActivity(db: Reader, session: SessionRow): Date {
	const last = db
		.select({ servedAt: question.servedAt, answeredAt: answer.answeredAt })
		.from(question)
		.leftJoin(answer, eq(answer.questionId, question.id))
		.where(eq(question.practiceSessionId, session.id))
		.orderBy(desc(question.id))
		.limit(1)
		.get();
	return last?.answeredAt ?? last?.servedAt ?? session.startedAt;
}

const questionsServed = (db: Reader, sessionId: number) =>
	db
		.select({ count: sql<number>`count(*)` })
		.from(question)
		.where(eq(question.practiceSessionId, sessionId))
		.get()!.count;

/**
 * The child's session in progress, if there is one. A session that was walked away
 * from is closed here as unfinished, dated to the last thing the child did in it.
 */
function openSession(db: Reader, childId: number, now: Date): SessionRow | null {
	const open = db
		.select()
		.from(practiceSession)
		.where(and(eq(practiceSession.childId, childId), isNull(practiceSession.endedAt)))
		.orderBy(desc(practiceSession.id))
		.all();

	let current: SessionRow | null = null;
	for (const session of open) {
		const last = lastActivity(db, session);
		if (!current && now.getTime() - last.getTime() < RESUME_WINDOW_MS) {
			current = session;
			continue;
		}
		db.update(practiceSession)
			.set({ endedAt: last, completed: false, questionCount: questionsServed(db, session.id) })
			.where(eq(practiceSession.id, session.id))
			.run();
	}
	return current;
}

/** Milliseconds of practice so far on the local day that contains `now`. */
export function activeMsToday(db: Reader, childId: number, now: Date, timeZone: string): number {
	return db
		.select({ total: sql<number>`coalesce(sum(${practiceSession.activeMs}), 0)` })
		.from(practiceSession)
		.where(
			and(
				eq(practiceSession.childId, childId),
				gte(practiceSession.startedAt, startOfLocalDay(now, timeZone))
			)
		)
		.get()!.total;
}

function capReached(db: Reader, who: PracticeChild, now: Date, timeZone: string): boolean {
	const cap = who.settings.dailyCapMinutes;
	return cap > 0 && activeMsToday(db, who.id, now, timeZone) >= cap * 60_000;
}

/**
 * Serves the next planned question: picks the wrong choices, shuffles, and records the
 * question with its correct answer. Returns false when the plan has run out.
 */
function serveNext(tx: Tx, session: SessionRow, clock: Clock): boolean {
	const words = eligibleWords(tx);
	const byId = new Map(words.map((entry) => [entry.id, entry]));
	const position = questionsServed(tx, session.id);

	// A word can be switched off by the parent after the plan was made; skip over it.
	const plan = [...session.planJson];
	while (position < plan.length && !byId.has(plan[position].wordId)) plan.splice(position, 1);
	if (plan.length !== session.planJson.length) {
		tx.update(practiceSession)
			.set({ planJson: plan })
			.where(eq(practiceSession.id, session.id))
			.run();
	}
	if (position >= plan.length) return false;

	const item = plan[position];
	const built = buildQuestion(byId.get(item.wordId)!, item.type, words, clock.rng);
	tx.insert(question)
		.values({
			practiceSessionId: session.id,
			wordId: item.wordId,
			type: built.type,
			choicesJson: built.choices,
			correctChoice: built.correctChoice,
			servedAt: clock.now
		})
		.run();
	return true;
}

export type StartResult = 'started' | 'resumed' | 'capped' | 'empty';

/** What the home page should offer: start, carry on, or come back tomorrow. */
export function practiceStatus(
	db: Db,
	who: PracticeChild,
	now: Date,
	timeZone: string
): 'ready' | 'resume' | 'capped' {
	if (openSession(db, who.id, now)) return 'resume';
	return capReached(db, who, now, timeZone) ? 'capped' : 'ready';
}

export function startPractice(db: Db, who: PracticeChild, clock: Clock): StartResult {
	const { now, timeZone, rng } = clock;

	return db.transaction((tx) => {
		if (openSession(tx, who.id, now)) return 'resumed';
		if (capReached(tx, who, now, timeZone)) return 'capped';

		const words = eligibleWords(tx);
		const eligible = new Set(words.map((entry) => entry.id));
		const progress = tx
			.select()
			.from(wordProgress)
			.where(eq(wordProgress.childId, who.id))
			.orderBy(asc(wordProgress.dueAt), asc(wordProgress.wordId))
			.all()
			.filter((row) => eligible.has(row.wordId));
		const seen = new Set(progress.map((row) => row.wordId));

		const plan = composePlan({
			due: progress.filter((row) => row.dueAt <= now),
			early: progress.filter((row) => row.dueAt > now && !row.masteredAt),
			fresh: shuffle(
				words.filter((entry) => entry.grade === who.grade && !seen.has(entry.id)),
				rng
			).map((entry) => entry.id),
			questionsPerSession: who.settings.questionsPerSession,
			newWordsPerSession: who.settings.newWordsPerSession,
			spellingEnabled: who.settings.spellingEnabled
		});
		if (plan.length === 0) return 'empty';

		const session = tx
			.insert(practiceSession)
			.values({ childId: who.id, startedAt: now, planJson: plan })
			.returning()
			.get();
		serveNext(tx, session, clock);
		return 'started';
	});
}

// ---- What the child sees ----

export interface Feedback {
	type: QuestionType;
	correct: boolean;
	word: string;
	definition: string;
	sentence: string;
	/** What the child picked or typed. */
	chosen: string;
	/** The choices again, each marked. Empty for a spelling question. */
	choices: { text: string; state: 'correct' | 'incorrect' | 'dimmed' }[];
}

export type View =
	| { kind: 'none' }
	| { kind: 'question'; position: number; total: number; question: PublicQuestion }
	| { kind: 'feedback'; position: number; total: number; last: boolean; feedback: Feedback };

/**
 * The current screen of the child's session. While a question is unanswered this
 * returns only what `publicQuestion` allows; the answer is added once it has been given.
 */
export function currentView(db: Db, childId: number, now: Date): View {
	const session = openSession(db, childId, now);
	if (!session) return { kind: 'none' };

	const last = db
		.select()
		.from(question)
		.where(eq(question.practiceSessionId, session.id))
		.orderBy(desc(question.id))
		.limit(1)
		.get();
	if (!last) return { kind: 'none' };

	const position = questionsServed(db, session.id);
	const total = Math.max(session.planJson.length, position);
	const target = wordInfo(db, last.wordId);
	const given = db.select().from(answer).where(eq(answer.questionId, last.id)).get();

	if (!given) {
		return {
			kind: 'question',
			position,
			total,
			question: publicQuestion(last.id, last.type, target, last.choicesJson)
		};
	}

	return {
		kind: 'feedback',
		position,
		total,
		last: position >= session.planJson.length,
		feedback: {
			type: last.type,
			correct: given.isCorrect,
			word: target.word,
			definition: target.definition,
			sentence: target.sentence,
			chosen: given.chosen,
			choices: last.choicesJson.map((text) => ({
				text,
				state:
					text === last.correctChoice ? 'correct' : text === given.chosen ? 'incorrect' : 'dimmed'
			}))
		}
	};
}

// ---- Answering ----

export interface AnswerInput {
	questionId: number;
	/** Index of the picked choice, for multiple choice. */
	choice?: number;
	/** What was typed, for a spelling question. */
	text?: string;
	/** Thinking time measured in the browser, if it sent one. */
	responseMs?: number;
}

/**
 * - recorded: the answer was checked and saved.
 * - stale: the question is not the one waiting for an answer (a double click, the back
 *   button, or another child's question). Nothing is changed.
 * - invalid: the answer was missing or made no sense. Nothing is changed.
 */
export type AnswerResult = 'recorded' | 'stale' | 'invalid';

export function submitAnswer(
	db: Db,
	childId: number,
	input: AnswerInput,
	clock: Pick<Clock, 'now' | 'timeZone'>
): AnswerResult {
	const { now, timeZone } = clock;

	return db.transaction((tx) => {
		// Only the signed-in child's own session is ever looked at.
		const session = openSession(tx, childId, now);
		if (!session) return 'stale';

		const asked = tx
			.select()
			.from(question)
			.where(eq(question.practiceSessionId, session.id))
			.orderBy(desc(question.id))
			.all();
		const current = asked[0];
		if (!current || current.id !== input.questionId) return 'stale';
		if (tx.select().from(answer).where(eq(answer.questionId, current.id)).get()) return 'stale';

		let chosen: string;
		if (current.type === 'spell') {
			chosen = (input.text ?? '').normalize('NFKC').trim().slice(0, SPELLING_MAX_LENGTH);
			if (!chosen) return 'invalid';
		} else {
			const picked = input.choice === undefined ? undefined : current.choicesJson[input.choice];
			if (picked === undefined) return 'invalid';
			chosen = picked;
		}

		const correct = isCorrect(current.type, current.correctChoice, chosen);
		const firstAskInSession = !asked.slice(1).some((earlier) => earlier.wordId === current.wordId);

		// Thinking time: trust the browser's own measurement when it is believable,
		// otherwise use the time between serving the question and receiving the answer.
		const elapsed = Math.max(0, now.getTime() - current.servedAt.getTime());
		const measured = input.responseMs;
		const responseMs =
			measured !== undefined &&
			Number.isFinite(measured) &&
			measured >= 0 &&
			measured <= elapsed + 1000
				? Math.round(measured)
				: elapsed;

		tx.insert(answer)
			.values({
				questionId: current.id,
				chosen,
				isCorrect: correct,
				responseMs,
				isRetry: !firstAskInSession,
				answeredAt: now
			})
			.run();

		// Move the word between boxes.
		const where = and(eq(wordProgress.childId, childId), eq(wordProgress.wordId, current.wordId));
		const state = tx.select().from(wordProgress).where(where).get();
		const outcome = applyAnswer(
			state ? { box: state.box, dueAt: state.dueAt, mastered: state.masteredAt !== null } : null,
			{ correct, firstAskInSession, now, timeZone }
		);
		if (state) {
			tx.update(wordProgress)
				.set({
					box: outcome.box,
					dueAt: outcome.dueAt,
					masteredAt: outcome.mastered ? (state.masteredAt ?? now) : null,
					timesSeen: state.timesSeen + 1,
					timesCorrect: state.timesCorrect + (correct ? 1 : 0)
				})
				.where(where)
				.run();
		} else {
			tx.insert(wordProgress)
				.values({
					childId,
					wordId: current.wordId,
					box: outcome.box,
					dueAt: outcome.dueAt,
					timesSeen: 1,
					timesCorrect: correct ? 1 : 0,
					firstSeenAt: now
				})
				.run();
		}

		// A missed word comes round again later in this session.
		const planJson: PlanItem[] = correct
			? session.planJson
			: withRetry(session.planJson, asked.length - 1, current.wordId);

		tx.update(practiceSession)
			.set({
				planJson,
				activeMs: session.activeMs + Math.min(elapsed, ACTIVE_GAP_CAP_MS)
			})
			.where(eq(practiceSession.id, session.id))
			.run();

		return 'recorded';
	});
}

// ---- Moving on and finishing ----

/** Share of the grade's words the child knows well (box 4 or above), from 0 to 1. */
export function gradeProgress(db: Reader, childId: number, grade: number): number {
	const words = eligibleWords(db).filter((entry) => entry.grade === grade);
	if (words.length === 0) return 0;

	const inGrade = new Set(words.map((entry) => entry.id));
	const known = db
		.select({ wordId: wordProgress.wordId })
		.from(wordProgress)
		.where(and(eq(wordProgress.childId, childId), gte(wordProgress.box, 4)))
		.all()
		.filter((row) => inGrade.has(row.wordId)).length;
	return known / words.length;
}

function finish(tx: Tx, session: SessionRow, who: PracticeChild, now: Date, completed: boolean) {
	tx.update(practiceSession)
		.set({ endedAt: now, completed, questionCount: questionsServed(tx, session.id) })
		.where(eq(practiceSession.id, session.id))
		.run();

	// Move up a grade when most of this one is well known, if the parent chose "automatic".
	const next = GRADES.find((grade) => grade > who.grade);
	if (
		completed &&
		next !== undefined &&
		who.settings.autoUnlockNextGrade &&
		gradeProgress(tx, who.id, who.grade) >= UNLOCK_SHARE
	) {
		tx.update(child).set({ grade: next }).where(eq(child.id, who.id)).run();
	}
}

/**
 * - question: the next question has been served.
 * - done: the session is finished.
 * - waiting: there is a question still to be answered, so nothing was done.
 * - none: there is no session.
 */
export type AdvanceResult = 'question' | 'done' | 'waiting' | 'none';

/** "Next" on the feedback screen. */
export function advance(db: Db, who: PracticeChild, clock: Clock): AdvanceResult {
	const { now } = clock;

	return db.transaction((tx) => {
		const session = openSession(tx, who.id, now);
		if (!session) return 'none';

		const last = tx
			.select({ id: question.id, answeredAt: answer.answeredAt })
			.from(question)
			.leftJoin(answer, eq(answer.questionId, question.id))
			.where(eq(question.practiceSessionId, session.id))
			.orderBy(desc(question.id))
			.limit(1)
			.get();
		if (last && !last.answeredAt) return 'waiting';

		// Time spent reading the feedback is practice too.
		const reading = last?.answeredAt ? Math.max(0, now.getTime() - last.answeredAt.getTime()) : 0;
		const activeMs = session.activeMs + Math.min(reading, ACTIVE_GAP_CAP_MS);
		tx.update(practiceSession).set({ activeMs }).where(eq(practiceSession.id, session.id)).run();

		if (serveNext(tx, session, clock)) return 'question';
		finish(tx, session, who, now, true);
		return 'done';
	});
}

/** "Stop for now": ends the session early. What was answered is kept. */
export function quit(db: Db, who: PracticeChild, now: Date): void {
	db.transaction((tx) => {
		const session = openSession(tx, who.id, now);
		if (session) finish(tx, session, who, now, false);
	});
}

// ---- Summary ----

/** Days on which the child finished at least one session, as local `YYYY-MM-DD` keys. */
export function practicedDays(db: Reader, childId: number, timeZone: string): Set<string> {
	const sessions = db
		.select({ endedAt: practiceSession.endedAt })
		.from(practiceSession)
		.where(and(eq(practiceSession.childId, childId), eq(practiceSession.completed, true)))
		.all();
	return new Set(
		sessions.flatMap(({ endedAt }) => (endedAt ? [localDayKey(endedAt, timeZone)] : []))
	);
}

export function streak(db: Reader, childId: number, now: Date, timeZone: string): number {
	return currentStreak(practicedDays(db, childId, timeZone), localDayKey(now, timeZone));
}

export interface Summary {
	/** Every question of the session, in order: true where the child got it right. */
	results: boolean[];
	newWords: number;
	streak: number;
	canPracticeAgain: boolean;
}

/** The session the child has just finished, or null if there is not a recent one. */
export function lastSummary(
	db: Db,
	who: PracticeChild,
	now: Date,
	timeZone: string
): Summary | null {
	const session = db
		.select()
		.from(practiceSession)
		.where(and(eq(practiceSession.childId, who.id), eq(practiceSession.completed, true)))
		.orderBy(desc(practiceSession.endedAt))
		.limit(1)
		.get();
	if (!session?.endedAt || now.getTime() - session.endedAt.getTime() > SUMMARY_WINDOW_MS) {
		return null;
	}

	const answers = db
		.select({ isCorrect: answer.isCorrect })
		.from(answer)
		.innerJoin(question, eq(question.id, answer.questionId))
		.where(eq(question.practiceSessionId, session.id))
		.orderBy(asc(question.id))
		.all();

	const newWords = db
		.select({ count: sql<number>`count(*)` })
		.from(wordProgress)
		.where(and(eq(wordProgress.childId, who.id), gte(wordProgress.firstSeenAt, session.startedAt)))
		.get()!.count;

	return {
		results: answers.map((row) => row.isCorrect),
		newWords,
		streak: streak(db, who.id, now, timeZone),
		canPracticeAgain: !capReached(db, who, now, timeZone)
	};
}
