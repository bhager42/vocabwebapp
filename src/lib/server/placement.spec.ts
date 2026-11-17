import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChild, type Child } from './children.ts';
import type { Db } from './db/client.ts';
import {
	answer,
	placementAnswer,
	practiceSession,
	question,
	word,
	wordList,
	wordProgress
} from './db/schema.ts';
import {
	answerQuiz,
	beginQuiz,
	cancelQuiz,
	finishedRecently,
	hasOpenQuiz,
	highestPassed,
	listQuizzes,
	nextStep,
	passed,
	pickWord,
	quizView,
	ROUND_SIZE,
	STALE_MS,
	startQuiz,
	type RoundResult
} from './placement.ts';
import type { WordInfo } from './questions.ts';
import { createTestDb } from './test-db.ts';

const round = (grade: number, correct: number, asked = ROUND_SIZE): RoundResult => ({
	grade,
	asked,
	correct
});

describe('passed', () => {
	it('needs 4 of 5', () => {
		expect(passed(round(3, 4))).toBe(true);
		expect(passed(round(3, 3))).toBe(false);
	});

	it('scales for a short round and fails an empty one', () => {
		expect(passed(round(3, 4, 5))).toBe(true);
		expect(passed(round(3, 2, 3))).toBe(false);
		expect(passed(round(3, 3, 3))).toBe(true);
		expect(passed(round(3, 0, 0))).toBe(false);
	});
});

describe('nextStep', () => {
	it('starts at the starting grade', () => {
		expect(nextStep([], 5)).toEqual({ kind: 'ask', grade: 5 });
	});

	it('goes up after a pass and down after a fail', () => {
		expect(nextStep([round(5, 5)], 5)).toEqual({ kind: 'ask', grade: 6 });
		expect(nextStep([round(5, 1)], 5)).toEqual({ kind: 'ask', grade: 4 });
	});

	it('stops at a pass followed by a fail on the way up', () => {
		expect(nextStep([round(5, 5), round(6, 4), round(7, 2)], 5)).toEqual({
			kind: 'done',
			grade: 6
		});
	});

	it('stops at the first pass on the way down', () => {
		// Grade 6 has already been failed, so a pass at 5 settles it.
		expect(nextStep([round(7, 2), round(6, 3), round(5, 4)], 7)).toEqual({
			kind: 'done',
			grade: 5
		});
	});

	it('does not ask a grade twice', () => {
		// Failed 7, passed 6 on the way down: 7 has already been tested.
		expect(nextStep([round(7, 1), round(6, 5)], 7)).toEqual({ kind: 'done', grade: 6 });
	});

	it('stops at a pass at grade 12', () => {
		expect(nextStep([round(11, 5), round(12, 5)], 11)).toEqual({ kind: 'done', grade: 12 });
	});

	it('stops at a fail at grade 3 and suggests 3', () => {
		expect(nextStep([round(4, 0), round(3, 1)], 4)).toEqual({ kind: 'done', grade: 3 });
	});

	it('never runs longer than one round per grade', () => {
		const rounds: RoundResult[] = [];
		let step = nextStep(rounds, 3);
		while (step.kind === 'ask') {
			rounds.push(round(step.grade, 5));
			step = nextStep(rounds, 3);
		}
		expect(rounds).toHaveLength(10);
		expect(step).toEqual({ kind: 'done', grade: 12 });
	});
});

describe('highestPassed', () => {
	it('is the highest grade passed, or 3', () => {
		expect(highestPassed([round(5, 5), round(6, 1)])).toBe(5);
		expect(highestPassed([round(5, 1), round(4, 0)])).toBe(3);
	});
});

describe('pickWord', () => {
	const info = (id: number, grade: number): WordInfo => ({
		id,
		listId: 1,
		grade,
		word: `w${id}`,
		partOfSpeech: 'noun',
		definition: `d${id}`,
		sentence: `s w${id}`,
		synonyms: []
	});
	const words = [info(1, 3), info(2, 3), info(3, 3), info(4, 4)];

	it('only picks from the grade, and not a word already asked', () => {
		for (let run = 0; run < 20; run++) {
			const picked = pickWord(words, 3, new Set([1]), new Set(), Math.random);
			expect([2, 3]).toContain(picked?.id);
		}
	});

	it('prefers a word not met in practice', () => {
		for (let run = 0; run < 20; run++) {
			expect(pickWord(words, 3, new Set(), new Set([1, 2]), Math.random)?.id).toBe(3);
		}
	});

	it('falls back to a practiced word, then to nothing', () => {
		expect(pickWord(words, 4, new Set(), new Set([4]), Math.random)?.id).toBe(4);
		expect(pickWord(words, 4, new Set([4]), new Set(), Math.random)).toBeNull();
	});
});

// ---- Against a database ----

const start = new Date('2026-11-10T22:00:00Z');
let db: Db;
let close: () => void;
let now: Date;
let sam: Child;

const tick = (ms = 5000) => (now = new Date(now.getTime() + ms));
const rng = () => 0.42;

function addGrade(grade: number, count = 8, source: 'builtin' | 'custom' = 'builtin') {
	const list = db
		.insert(wordList)
		.values({ name: `Grade ${grade} ${source}`, grade, source })
		.returning()
		.get();
	for (let index = 1; index <= count; index++) {
		db.insert(word)
			.values({
				listId: list.id,
				word: `${source}${grade}w${index}`,
				partOfSpeech: 'adjective',
				definition: `meaning of ${source}${grade}w${index}`,
				sentence: `It was a ${source}${grade}w${index} day.`
			})
			.run();
	}
	return list;
}

/** The correct answer of the waiting question, read the way only the server can. */
function waitingAnswer(childId: number) {
	const view = quizView(db, childId, now);
	if (view.kind !== 'question') throw new Error(`no question: ${view.kind}`);
	const row = db.select().from(placementAnswer).where(eq(placementAnswer.id, view.id)).get()!;
	return { view, row, right: view.choices.indexOf(row.correctChoice) };
}

/** Answers questions until the quiz ends: right at grades up to `knows`, wrong above. */
function play(childId: number, knows: number) {
	let result: string = beginQuiz(db, childId, now, rng);
	let guard = 0;
	while (result === 'question' && guard++ < 100) {
		const { view, row, right } = waitingAnswer(childId);
		tick();
		result = answerQuiz(
			db,
			childId,
			row.grade <= knows
				? { questionId: view.id, choice: right }
				: { questionId: view.id, dontKnow: true },
			now,
			rng
		);
	}
	return result;
}

const count = (
	table: typeof question | typeof answer | typeof practiceSession | typeof wordProgress
) =>
	db
		.select({ n: sql<number>`count(*)` })
		.from(table)
		.get()!.n;

beforeEach(() => {
	({ db, close } = createTestDb());
	now = start;
	for (const grade of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) addGrade(grade);
	const made = createChild(db, { name: 'Sam', grade: 5 }, start);
	if (!made.ok) throw new Error('setup');
	sam = made.child;
});

afterEach(() => close());

describe('a quiz', () => {
	it('is not there until the parent starts one', () => {
		expect(hasOpenQuiz(db, sam.id, now)).toBe(false);
		expect(quizView(db, sam.id, now)).toEqual({ kind: 'none' });
		expect(beginQuiz(db, sam.id, now, rng)).toBe('none');
	});

	it('opens once, starting at the child grade', () => {
		startQuiz(db, sam.id, sam.grade, now);
		startQuiz(db, sam.id, sam.grade, now);
		const quizzes = listQuizzes(db, sam.id, now);
		expect(quizzes).toHaveLength(1);
		expect(quizzes[0].state).toBe('open');
		expect(quizView(db, sam.id, now)).toEqual({ kind: 'intro', started: false });

		beginQuiz(db, sam.id, now, rng);
		const { row } = waitingAnswer(sam.id);
		expect(row.grade).toBe(5);
	});

	it('finds the grade the child knows', () => {
		startQuiz(db, sam.id, sam.grade, now);
		expect(play(sam.id, 7)).toBe('done');
		const [quiz] = listQuizzes(db, sam.id, now);
		expect(quiz.state).toBe('finished');
		expect(quiz.resultGrade).toBe(7);
		expect(quiz.rounds.map((entry) => [entry.grade, entry.correct])).toEqual([
			[5, 5],
			[6, 5],
			[7, 5],
			[8, 0]
		]);
		expect(hasOpenQuiz(db, sam.id, now)).toBe(false);
		expect(finishedRecently(db, sam.id, now)).toBe(true);
	});

	it('goes down for a child who finds the start too hard', () => {
		startQuiz(db, sam.id, sam.grade, now);
		play(sam.id, 3);
		const [quiz] = listQuizzes(db, sam.id, now);
		expect(quiz.resultGrade).toBe(3);
		expect(quiz.rounds.map((entry) => entry.grade)).toEqual([5, 4, 3]);
	});

	it('asks only built-in words, never the same word twice', () => {
		addGrade(5, 8, 'custom');
		startQuiz(db, sam.id, sam.grade, now);
		play(sam.id, 12);
		const rows = db.select().from(placementAnswer).all();
		const custom = new Set(
			db
				.select({ id: word.id })
				.from(word)
				.innerJoin(wordList, eq(wordList.id, word.listId))
				.where(eq(wordList.source, 'custom'))
				.all()
				.map((entry) => entry.id)
		);
		expect(rows.some((row) => custom.has(row.wordId))).toBe(false);
		expect(new Set(rows.map((row) => row.wordId)).size).toBe(rows.length);
	});

	it('changes no practice data', () => {
		const before = [question, answer, practiceSession, wordProgress].map(count);
		startQuiz(db, sam.id, sam.grade, now);
		play(sam.id, 6);
		expect([question, answer, practiceSession, wordProgress].map(count)).toEqual(before);
	});

	it('never puts the answer in what the child sees', () => {
		startQuiz(db, sam.id, sam.grade, now);
		beginQuiz(db, sam.id, now, rng);
		const { view, row } = waitingAnswer(sam.id);
		// The definition is one of the choices, but nothing marks which.
		expect(Object.keys(view).sort()).toEqual([
			'choices',
			'id',
			'kind',
			'position',
			'round',
			'word'
		]);
		expect(view.choices).toContain(row.correctChoice);
	});

	it('ignores a stale or another child’s answer, and an empty one', () => {
		const other = createChild(db, { name: 'Alex', grade: 5 }, start);
		if (!other.ok) throw new Error('setup');
		startQuiz(db, sam.id, sam.grade, now);
		beginQuiz(db, sam.id, now, rng);
		const { view } = waitingAnswer(sam.id);

		expect(answerQuiz(db, other.child.id, { questionId: view.id, choice: 0 }, now, rng)).toBe(
			'stale'
		);
		expect(answerQuiz(db, sam.id, { questionId: view.id + 1, choice: 0 }, now, rng)).toBe('stale');
		expect(answerQuiz(db, sam.id, { questionId: view.id }, now, rng)).toBe('invalid');
		expect(answerQuiz(db, sam.id, { questionId: view.id, choice: 9 }, now, rng)).toBe('invalid');
		expect(answerQuiz(db, sam.id, { questionId: view.id, choice: 0 }, now, rng)).toBe('question');
		expect(answerQuiz(db, sam.id, { questionId: view.id, choice: 0 }, now, rng)).toBe('stale');
	});

	it('picks up where the child stopped', () => {
		startQuiz(db, sam.id, sam.grade, now);
		beginQuiz(db, sam.id, now, rng);
		const first = waitingAnswer(sam.id);
		answerQuiz(db, sam.id, { questionId: first.view.id, choice: first.right }, now, rng);
		const second = waitingAnswer(sam.id);
		tick(60 * 60_000);
		expect(beginQuiz(db, sam.id, now, rng)).toBe('question');
		expect(waitingAnswer(sam.id).view.id).toBe(second.view.id);
		expect(second.view.position).toBe(2);
	});

	it('can be cancelled by the parent', () => {
		startQuiz(db, sam.id, sam.grade, now);
		expect(cancelQuiz(db, sam.id, now)).toBe(true);
		expect(cancelQuiz(db, sam.id, now)).toBe(false);
		expect(listQuizzes(db, sam.id, now)[0].state).toBe('cancelled');
		expect(beginQuiz(db, sam.id, now, rng)).toBe('none');
	});

	it('is closed unfinished after a week untouched', () => {
		startQuiz(db, sam.id, sam.grade, now);
		beginQuiz(db, sam.id, now, rng);
		tick(STALE_MS);
		expect(hasOpenQuiz(db, sam.id, now)).toBe(false);
		expect(listQuizzes(db, sam.id, now)[0].state).toBe('unfinished');
	});

	it('ends where it stands when the next grade has no words', () => {
		db.update(wordList).set({ active: false }).where(eq(wordList.grade, 6)).run();
		startQuiz(db, sam.id, sam.grade, now);
		expect(play(sam.id, 12)).toBe('done');
		expect(listQuizzes(db, sam.id, now)[0].resultGrade).toBe(5);
	});
});
