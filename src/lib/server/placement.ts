// The placement quiz: a few rounds of questions that find the grade a child should start
// at. See PLAN.md Phase 11.
//
// It is kept apart from practice on purpose. It writes only to placement_quiz and
// placement_answer, so it never moves a word between boxes and never counts toward the
// dashboard, the streak or the daily limit. Like practice, the correct answer stays on
// the server until the child has answered.

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { GRADES } from './children.ts';
import type { Db } from './db/client.ts';
import { placementAnswer, placementQuiz, word, wordList, wordProgress } from './db/schema.ts';
import { buildQuestion, shuffle, type Rng, type WordInfo } from './questions.ts';

/** Questions asked at each grade. */
export const ROUND_SIZE = 5;
/** Right answers out of ROUND_SIZE needed to pass a grade. */
export const PASS_MARK = 4;
/** A quiz nobody has touched for this long is closed unfinished. */
export const STALE_MS = 7 * 24 * 60 * 60_000;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Db | Tx;
type QuizRow = typeof placementQuiz.$inferSelect;

// ---- The staircase (pure) ----

export interface RoundResult {
	grade: number;
	asked: number;
	correct: number;
}

/** A round passes at 4 of 5, or the same share of a shorter round. An empty round fails. */
export const passed = (round: RoundResult) =>
	round.asked > 0 && round.correct * ROUND_SIZE >= round.asked * PASS_MARK;

export type Step = { kind: 'ask'; grade: number } | { kind: 'done'; grade: number };

/** The grade a quiz suggests: the highest grade passed, or the lowest grade if none was. */
export function highestPassed(
	rounds: readonly RoundResult[],
	grades: readonly number[] = GRADES
): number {
	const passes = rounds.filter(passed).map((round) => round.grade);
	return passes.length ? Math.max(...passes) : grades[0];
}

/**
 * What comes after the finished rounds so far: the grade to ask about next, or the grade
 * the quiz suggests.
 *
 * Pass a grade and the quiz goes up one; fail it and it goes down one. It stops at a
 * passed grade whose next grade was failed, at a pass at the top grade, or at a fail at
 * the bottom grade. The suggestion is the highest grade passed, or the lowest grade if
 * none was.
 */
export function nextStep(
	rounds: readonly RoundResult[],
	startGrade: number,
	grades: readonly number[] = GRADES
): Step {
	const last = rounds.at(-1);
	if (!last) return { kind: 'ask', grade: startGrade };

	const tested = new Set(rounds.map((round) => round.grade));
	const index = grades.indexOf(last.grade);
	const move = passed(last) ? grades[index + 1] : grades[index - 1];
	if (move === undefined || tested.has(move)) {
		return { kind: 'done', grade: highestPassed(rounds, grades) };
	}
	return { kind: 'ask', grade: move };
}

// ---- Words ----

/** Active built-in words, in active lists. Custom lists have no grade level to test. */
function builtinWords(db: Reader): WordInfo[] {
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
		.where(and(eq(word.active, true), eq(wordList.active, true), eq(wordList.source, 'builtin')))
		.all();
}

/**
 * The next word to ask at `grade`: one not yet asked in this quiz, preferring a word the
 * child has not met in practice so the quiz measures what they already knew.
 */
export function pickWord(
	candidates: readonly WordInfo[],
	grade: number,
	asked: ReadonlySet<number>,
	practiced: ReadonlySet<number>,
	rng: Rng
): WordInfo | null {
	const open = shuffle(
		candidates.filter((entry) => entry.grade === grade && !asked.has(entry.id)),
		rng
	);
	return open.find((entry) => !practiced.has(entry.id)) ?? open[0] ?? null;
}

// ---- Reading a quiz ----

function answersFor(db: Reader, quizId: number) {
	return db
		.select()
		.from(placementAnswer)
		.where(eq(placementAnswer.quizId, quizId))
		.orderBy(asc(placementAnswer.id))
		.all();
}

type AnswerRow = ReturnType<typeof answersFor>[number];

/** Answered questions grouped into rounds, in the order the grades were asked. */
export function roundsOf(answers: readonly AnswerRow[]): RoundResult[] {
	const rounds: RoundResult[] = [];
	for (const row of answers) {
		if (row.chosen === null) continue;
		let round = rounds.find((entry) => entry.grade === row.grade);
		if (!round) {
			round = { grade: row.grade, asked: 0, correct: 0 };
			rounds.push(round);
		}
		round.asked++;
		if (row.isCorrect) round.correct++;
	}
	return rounds;
}

const lastTouched = (quiz: QuizRow, answers: readonly AnswerRow[]) =>
	answers.reduce(
		(latest, row) => Math.max(latest, (row.answeredAt ?? row.servedAt).getTime()),
		quiz.startedAt.getTime()
	);

/** The child's unfinished quiz, closing one that has been left alone too long. */
function openQuiz(db: Reader, childId: number, now: Date): QuizRow | null {
	const quiz = db
		.select()
		.from(placementQuiz)
		.where(and(eq(placementQuiz.childId, childId), isNull(placementQuiz.endedAt)))
		.orderBy(desc(placementQuiz.id))
		.get();
	if (!quiz) return null;

	const last = lastTouched(quiz, answersFor(db, quiz.id));
	if (now.getTime() - last < STALE_MS) return quiz;
	db.update(placementQuiz)
		.set({ endedAt: new Date(last) })
		.where(eq(placementQuiz.id, quiz.id))
		.run();
	return null;
}

export const hasOpenQuiz = (db: Db, childId: number, now: Date) =>
	openQuiz(db, childId, now) !== null;

// ---- The parent's side ----

/** Opens a quiz for the child, starting at their current grade. Keeps one already open. */
export function startQuiz(db: Db, childId: number, grade: number, now: Date): void {
	db.transaction((tx) => {
		if (openQuiz(tx, childId, now)) return;
		tx.insert(placementQuiz).values({ childId, startedAt: now, startGrade: grade }).run();
	});
}

/** Closes the child's open quiz without a result. Returns false if there was none. */
export function cancelQuiz(db: Db, childId: number, now: Date): boolean {
	return db.transaction((tx) => {
		const quiz = openQuiz(tx, childId, now);
		if (!quiz) return false;
		tx.update(placementQuiz)
			.set({ endedAt: now, cancelled: true })
			.where(eq(placementQuiz.id, quiz.id))
			.run();
		return true;
	});
}

export interface QuizSummary {
	id: number;
	startedAt: Date;
	endedAt: Date | null;
	state: 'open' | 'finished' | 'cancelled' | 'unfinished';
	resultGrade: number | null;
	rounds: RoundResult[];
}

/** The child's quizzes, newest first. */
export function listQuizzes(db: Db, childId: number, now: Date): QuizSummary[] {
	openQuiz(db, childId, now); // closes a stale one first, so its state is right
	return db
		.select()
		.from(placementQuiz)
		.where(eq(placementQuiz.childId, childId))
		.orderBy(desc(placementQuiz.id))
		.all()
		.map((quiz) => ({
			id: quiz.id,
			startedAt: quiz.startedAt,
			endedAt: quiz.endedAt,
			state: !quiz.endedAt
				? 'open'
				: quiz.completed
					? 'finished'
					: quiz.cancelled
						? 'cancelled'
						: 'unfinished',
			resultGrade: quiz.resultGrade,
			rounds: roundsOf(answersFor(db, quiz.id))
		}));
}

// ---- The child's side ----

/** Serves the next question, or finishes the quiz. Returns true if a question was served. */
function serveNext(tx: Tx, quiz: QuizRow, now: Date, rng: Rng): boolean {
	const answers = answersFor(tx, quiz.id);
	const rounds = roundsOf(answers);
	const words = builtinWords(tx);
	const asked = new Set(answers.map((row) => row.wordId));
	const practiced = new Set(
		tx
			.select({ wordId: wordProgress.wordId })
			.from(wordProgress)
			.where(eq(wordProgress.childId, quiz.childId))
			.all()
			.map((row) => row.wordId)
	);

	// Carry on with the current round until it has ROUND_SIZE questions, or the grade has
	// run out of words; then let the staircase decide.
	const current = rounds.at(-1);
	let grade: number | null = null;
	let target: WordInfo | null = null;
	if (current && current.asked < ROUND_SIZE) {
		target = pickWord(words, current.grade, asked, practiced, rng);
		if (target) grade = current.grade;
	}
	if (!target) {
		const step = nextStep(rounds, quiz.startGrade);
		if (step.kind === 'ask') {
			target = pickWord(words, step.grade, asked, practiced, rng);
			grade = step.grade;
		}
		if (step.kind === 'done' || !target) {
			// A grade with no words at all ends the quiz where it stands.
			const result = step.kind === 'done' ? step.grade : highestPassed(rounds);
			tx.update(placementQuiz)
				.set({ endedAt: now, completed: true, resultGrade: result })
				.where(eq(placementQuiz.id, quiz.id))
				.run();
			return false;
		}
	}

	const built = buildQuestion(target, 'word_to_def', words, rng);
	tx.insert(placementAnswer)
		.values({
			quizId: quiz.id,
			grade: grade!,
			wordId: target.id,
			choicesJson: built.choices,
			correctChoice: built.correctChoice,
			servedAt: now
		})
		.run();
	return true;
}

export type QuizView =
	| { kind: 'none' }
	| { kind: 'intro'; started: boolean }
	| {
			kind: 'question';
			id: number;
			word: string;
			choices: string[];
			/** Which question of this round, from 1. */
			position: number;
			round: number;
	  };

/** What the child should see. Never includes the answer to the question on screen. */
export function quizView(db: Db, childId: number, now: Date): QuizView {
	return db.transaction((tx) => {
		const quiz = openQuiz(tx, childId, now);
		if (!quiz) return { kind: 'none' };

		const answers = answersFor(tx, quiz.id);
		const waiting = answers.at(-1);
		if (!waiting || waiting.chosen !== null) {
			return { kind: 'intro', started: answers.length > 0 };
		}

		const inRound = answers.filter((row) => row.grade === waiting.grade).length;
		const round = new Set(answers.map((row) => row.grade)).size;
		const target = tx
			.select({ word: word.word })
			.from(word)
			.where(eq(word.id, waiting.wordId))
			.get()!;
		return {
			kind: 'question',
			id: waiting.id,
			word: target.word,
			choices: waiting.choicesJson,
			position: inRound,
			round
		};
	});
}

/**
 * "Start the quiz" or "Keep going": serves a question if none is waiting.
 * Returns 'question' when one is on screen, 'done' if the quiz finished, 'none' if there
 * is no quiz.
 */
export function beginQuiz(
	db: Db,
	childId: number,
	now: Date,
	rng: Rng
): 'question' | 'done' | 'none' {
	return db.transaction((tx) => {
		const quiz = openQuiz(tx, childId, now);
		if (!quiz) return 'none';
		const waiting = answersFor(tx, quiz.id).at(-1);
		if (waiting && waiting.chosen === null) return 'question';
		return serveNext(tx, quiz, now, rng) ? 'question' : 'done';
	});
}

export interface QuizAnswer {
	questionId: number;
	/** Index of the picked choice, or undefined for "I don't know this one". */
	choice?: number;
	dontKnow?: boolean;
}

/**
 * Records an answer and serves the next question.
 * - question / done: recorded, and the quiz moved on or finished.
 * - stale: not the question waiting (double click, Back, or not this child's). Nothing changed.
 * - invalid: no answer given. Nothing changed.
 */
export function answerQuiz(
	db: Db,
	childId: number,
	input: QuizAnswer,
	now: Date,
	rng: Rng
): 'question' | 'done' | 'stale' | 'invalid' {
	return db.transaction((tx) => {
		// Only the signed-in child's own quiz is ever looked at.
		const quiz = openQuiz(tx, childId, now);
		if (!quiz) return 'stale';
		const waiting = answersFor(tx, quiz.id).at(-1);
		if (!waiting || waiting.id !== input.questionId || waiting.chosen !== null) return 'stale';

		let chosen: string;
		if (input.dontKnow) {
			chosen = '';
		} else {
			const picked = input.choice === undefined ? undefined : waiting.choicesJson[input.choice];
			if (picked === undefined) return 'invalid';
			chosen = picked;
		}

		tx.update(placementAnswer)
			.set({ chosen, isCorrect: chosen === waiting.correctChoice, answeredAt: now })
			.where(eq(placementAnswer.id, waiting.id))
			.run();
		return serveNext(tx, quiz, now, rng) ? 'question' : 'done';
	});
}

/** True when the child finished a quiz within the last hour, for the "All done" page. */
export function finishedRecently(db: Db, childId: number, now: Date): boolean {
	const quiz = db
		.select({ endedAt: placementQuiz.endedAt })
		.from(placementQuiz)
		.where(and(eq(placementQuiz.childId, childId), eq(placementQuiz.completed, true)))
		.orderBy(desc(placementQuiz.id))
		.get();
	return !!quiz?.endedAt && now.getTime() - quiz.endedAt.getTime() < 60 * 60_000;
}
