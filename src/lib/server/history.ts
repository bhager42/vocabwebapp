// The detail behind the dashboard: each session with its questions, each word with every
// answer given for it, and the export of all answers. See PLAN.md section 5.
//
// Every function takes the child's id and looks only at that child's rows, so an id from
// one child's page can never show or delete another child's practice.

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import {
	answer,
	practiceSession,
	question,
	word,
	wordList,
	wordProgress,
	type QuestionType
} from './db/schema.ts';
import { lastActivity, RESUME_WINDOW_MS } from './practice.ts';
import { localDayKey } from './time.ts';

export type SessionStatus = 'finished' | 'stopped' | 'in-progress';

export interface SessionEntry {
	id: number;
	startedAt: Date;
	activeMs: number;
	status: SessionStatus;
	answered: number;
	correct: number;
}

type SessionRow = typeof practiceSession.$inferSelect;

function statusOf(db: Db, session: SessionRow, now: Date): SessionStatus {
	if (session.completed) return 'finished';
	// A session that was walked away from is only marked as ended when the child next
	// comes back, so an open one counts as in progress only while it can be resumed.
	if (!session.endedAt && now.getTime() - lastActivity(db, session).getTime() < RESUME_WINDOW_MS) {
		return 'in-progress';
	}
	return 'stopped';
}

function tally(db: Db, sessionId: number) {
	return db
		.select({
			answered: sql<number>`count(*)`,
			correct: sql<number>`coalesce(sum(${answer.isCorrect}), 0)`
		})
		.from(answer)
		.innerJoin(question, eq(question.id, answer.questionId))
		.where(eq(question.practiceSessionId, sessionId))
		.get()!;
}

export const SESSIONS_PER_PAGE = 25;

/** The child's sessions, newest first, one page at a time (pages count from 1). */
export function sessionLog(
	db: Db,
	childId: number,
	now: Date,
	page = 1
): { sessions: SessionEntry[]; pages: number } {
	const total = db
		.select({ count: sql<number>`count(*)` })
		.from(practiceSession)
		.where(eq(practiceSession.childId, childId))
		.get()!.count;

	const rows = db
		.select()
		.from(practiceSession)
		.where(eq(practiceSession.childId, childId))
		.orderBy(desc(practiceSession.startedAt), desc(practiceSession.id))
		.limit(SESSIONS_PER_PAGE)
		.offset((page - 1) * SESSIONS_PER_PAGE)
		.all();

	return {
		pages: Math.max(1, Math.ceil(total / SESSIONS_PER_PAGE)),
		sessions: rows.map((row) => ({
			id: row.id,
			startedAt: row.startedAt,
			activeMs: row.activeMs,
			status: statusOf(db, row, now),
			...tally(db, row.id)
		}))
	};
}

export interface AnswerEntry {
	word: string;
	wordId: number;
	type: QuestionType;
	/** What the child picked or typed. Null if the question was never answered. */
	chosen: string | null;
	correctChoice: string;
	isCorrect: boolean | null;
	responseMs: number | null;
	/** The word had already been asked earlier in the same session. */
	isRetry: boolean;
	at: Date;
}

export interface SessionDetail extends SessionEntry {
	questions: AnswerEntry[];
}

/** One session with every question it asked, in order. Null if it is not this child's. */
export function sessionDetail(
	db: Db,
	childId: number,
	sessionId: number,
	now: Date
): SessionDetail | null {
	const session = db
		.select()
		.from(practiceSession)
		.where(and(eq(practiceSession.id, sessionId), eq(practiceSession.childId, childId)))
		.get();
	if (!session) return null;

	const questions = db
		.select({
			word: word.word,
			wordId: word.id,
			type: question.type,
			chosen: answer.chosen,
			correctChoice: question.correctChoice,
			isCorrect: answer.isCorrect,
			responseMs: answer.responseMs,
			isRetry: answer.isRetry,
			servedAt: question.servedAt
		})
		.from(question)
		.innerJoin(word, eq(word.id, question.wordId))
		.leftJoin(answer, eq(answer.questionId, question.id))
		.where(eq(question.practiceSessionId, sessionId))
		.orderBy(asc(question.id))
		.all();

	return {
		id: session.id,
		startedAt: session.startedAt,
		activeMs: session.activeMs,
		status: statusOf(db, session, now),
		...tally(db, session.id),
		questions: questions.map(({ servedAt, isRetry, ...rest }) => ({
			...rest,
			isRetry: isRetry ?? false,
			at: servedAt
		}))
	};
}

/**
 * Removes a session with its questions and answers, so it no longer counts toward any
 * figure. The boxes the words reached are left as they are: undoing those would mean
 * replaying everything since. Returns false if the session is not this child's.
 */
export function deleteSession(db: Db, childId: number, sessionId: number): boolean {
	return (
		db
			.delete(practiceSession)
			.where(and(eq(practiceSession.id, sessionId), eq(practiceSession.childId, childId)))
			.run().changes > 0
	);
}

// ---- Words ----

export type WordStage = 'learning' | 'almost' | 'mastered';

export const stageOf = (box: number, mastered: boolean): WordStage =>
	mastered ? 'mastered' : box >= 4 ? 'almost' : 'learning';

export interface WordEntry {
	wordId: number;
	word: string;
	grade: number;
	box: number;
	stage: WordStage;
	timesSeen: number;
	timesCorrect: number;
	dueAt: Date;
}

/** Every word the child has met, the shakiest first. */
export function wordTable(db: Db, childId: number): WordEntry[] {
	return db
		.select({
			wordId: word.id,
			word: word.word,
			grade: wordList.grade,
			box: wordProgress.box,
			masteredAt: wordProgress.masteredAt,
			timesSeen: wordProgress.timesSeen,
			timesCorrect: wordProgress.timesCorrect,
			dueAt: wordProgress.dueAt
		})
		.from(wordProgress)
		.innerJoin(word, eq(word.id, wordProgress.wordId))
		.innerJoin(wordList, eq(wordList.id, word.listId))
		.where(eq(wordProgress.childId, childId))
		.orderBy(asc(wordProgress.box), asc(word.word))
		.all()
		.map(({ masteredAt, ...row }) => ({ ...row, stage: stageOf(row.box, masteredAt !== null) }))
		.sort((a, b) => Number(a.stage === 'mastered') - Number(b.stage === 'mastered'));
}

export interface WordHistory {
	wordId: number;
	word: string;
	partOfSpeech: string;
	definition: string;
	sentence: string;
	grade: number;
	/** Null if the child has not been asked this word. */
	progress: Omit<WordEntry, 'wordId' | 'word' | 'grade'> | null;
	/** Every answer the child gave for the word, newest first. */
	answers: (AnswerEntry & { sessionId: number })[];
}

export function wordHistory(db: Db, childId: number, wordId: number): WordHistory | null {
	const info = db
		.select({
			wordId: word.id,
			word: word.word,
			partOfSpeech: word.partOfSpeech,
			definition: word.definition,
			sentence: word.sentence,
			grade: wordList.grade
		})
		.from(word)
		.innerJoin(wordList, eq(wordList.id, word.listId))
		.where(eq(word.id, wordId))
		.get();
	if (!info) return null;

	const progress = db
		.select()
		.from(wordProgress)
		.where(and(eq(wordProgress.childId, childId), eq(wordProgress.wordId, wordId)))
		.get();

	const answers = db
		.select({
			sessionId: question.practiceSessionId,
			type: question.type,
			chosen: answer.chosen,
			correctChoice: question.correctChoice,
			isCorrect: answer.isCorrect,
			responseMs: answer.responseMs,
			isRetry: answer.isRetry,
			at: answer.answeredAt
		})
		.from(answer)
		.innerJoin(question, eq(question.id, answer.questionId))
		.innerJoin(practiceSession, eq(practiceSession.id, question.practiceSessionId))
		.where(and(eq(practiceSession.childId, childId), eq(question.wordId, wordId)))
		.orderBy(desc(answer.answeredAt), desc(question.id))
		.all();

	return {
		...info,
		progress: progress
			? {
					box: progress.box,
					stage: stageOf(progress.box, progress.masteredAt !== null),
					timesSeen: progress.timesSeen,
					timesCorrect: progress.timesCorrect,
					dueAt: progress.dueAt
				}
			: null,
		answers: answers.map((row) => ({ ...row, word: info.word, wordId }))
	};
}

// ---- Export ----

/**
 * One cell of a CSV file. Text that a spreadsheet would run as a formula (it starts with
 * =, +, - or @) gets a leading apostrophe: some of this text was typed by a child, and
 * opening the file must never do anything but show it.
 */
export function csvCell(value: string | number): string {
	let text = String(value);
	if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const CSV_HEADER = [
	'answered_at_utc',
	'local_date',
	'session',
	'word',
	'grade',
	'question_type',
	'correct',
	'answer_given',
	'right_answer',
	'seconds',
	'asked_again_in_session'
];

/** Every answer the child has given, oldest first, as a CSV file. */
export function answersCsv(db: Db, childId: number, timeZone: string): string {
	const rows = db
		.select({
			answeredAt: answer.answeredAt,
			sessionId: question.practiceSessionId,
			word: word.word,
			grade: wordList.grade,
			type: question.type,
			isCorrect: answer.isCorrect,
			chosen: answer.chosen,
			correctChoice: question.correctChoice,
			responseMs: answer.responseMs,
			isRetry: answer.isRetry
		})
		.from(answer)
		.innerJoin(question, eq(question.id, answer.questionId))
		.innerJoin(practiceSession, eq(practiceSession.id, question.practiceSessionId))
		.innerJoin(word, eq(word.id, question.wordId))
		.innerJoin(wordList, eq(wordList.id, word.listId))
		.where(eq(practiceSession.childId, childId))
		.orderBy(asc(answer.answeredAt), asc(question.id))
		.all();

	const lines = rows.map((row) =>
		[
			row.answeredAt.toISOString(),
			localDayKey(row.answeredAt, timeZone),
			row.sessionId,
			row.word,
			row.grade,
			row.type,
			row.isCorrect ? 'yes' : 'no',
			row.chosen,
			row.correctChoice,
			(row.responseMs / 1000).toFixed(1),
			row.isRetry ? 'yes' : 'no'
		]
			.map(csvCell)
			.join(',')
	);
	// CRLF line ends, as the CSV standard (RFC 4180) asks.
	return [CSV_HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}
