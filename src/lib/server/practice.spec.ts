import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChild, DEFAULT_SETTINGS, type Child } from './children.ts';
import type { Db } from './db/client.ts';
import {
	answer,
	child,
	practiceSession,
	question,
	word,
	wordList,
	wordProgress
} from './db/schema.ts';
import {
	activeMsToday,
	advance,
	currentView,
	gradeProgress,
	lastSummary,
	practiceStatus,
	quit,
	startPractice,
	streak,
	submitAnswer,
	type Clock,
	type View
} from './practice.ts';
import { createTestDb } from './test-db.ts';

const CHICAGO = 'America/Chicago';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// 4pm on Tuesday 10 November 2026 in Chicago.
const start = new Date('2026-11-10T22:00:00Z');

let db: Db;
let close: () => void;
let now: Date;
let sam: Child;

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}
const rng = seeded();

const clock = (): Clock => ({ now, timeZone: CHICAGO, rng });
const tick = (ms = 5000) => (now = new Date(now.getTime() + ms));

/** Adds a list of made-up words: w1, w2, ... all adjectives. */
function addWords(grade: number, count: number, prefix = `g${grade}w`) {
	const list = db
		.insert(wordList)
		.values({ name: `Grade ${grade}`, grade, source: 'builtin' })
		.returning()
		.get();
	for (let index = 1; index <= count; index++) {
		db.insert(word)
			.values({
				listId: list.id,
				word: `${prefix}${index}`,
				partOfSpeech: 'adjective',
				definition: `meaning of ${prefix}${index}`,
				sentence: `It was a ${prefix}${index} day.`
			})
			.run();
	}
	return list;
}

function newChild(name: string, grade = 3): Child {
	const result = createChild(db, { name, grade }, start);
	if (!result.ok) throw new Error('could not create child');
	return result.child;
}

const view = (who = sam): View => currentView(db, who.id, now);

/** The question waiting for an answer, with what only the server knows about it. */
function pending(who = sam) {
	const row = db
		.select({ question, word: word.word })
		.from(question)
		.innerJoin(practiceSession, eq(practiceSession.id, question.practiceSessionId))
		.innerJoin(word, eq(word.id, question.wordId))
		.where(eq(practiceSession.childId, who.id))
		.orderBy(question.id)
		.all()
		.at(-1)!;
	return { ...row.question, word: row.word };
}

/** Answers the waiting question, rightly or wrongly, then presses Next. */
function answerNext(correct: boolean, who = sam) {
	const current = pending(who);
	tick();
	let input;
	if (current.type === 'spell') {
		input = { questionId: current.id, text: correct ? current.correctChoice : 'zzz' };
	} else {
		const right = current.choicesJson.indexOf(current.correctChoice);
		input = { questionId: current.id, choice: correct ? right : (right + 1) % 4 };
	}
	expect(submitAnswer(db, who.id, input, clock())).toBe('recorded');
	tick();
	return advance(db, who, clock());
}

/** Plays a whole session. `wrongAt` lists the question numbers (from 1) to get wrong. */
function playSession(wrongAt: number[] = [], who = sam) {
	expect(startPractice(db, who, clock())).toBe('started');
	let asked = 1;
	while (answerNext(!wrongAt.includes(asked), who) === 'question') asked++;
	return asked;
}

const progressOf = (name: string, who = sam) =>
	db
		.select({
			box: wordProgress.box,
			dueAt: wordProgress.dueAt,
			masteredAt: wordProgress.masteredAt
		})
		.from(wordProgress)
		.innerJoin(word, eq(word.id, wordProgress.wordId))
		.where(and(eq(word.word, name), eq(wordProgress.childId, who.id)))
		.get();

const sessions = () => db.select().from(practiceSession).all();
const answers = () => db.select().from(answer).orderBy(answer.questionId).all();

beforeEach(() => {
	({ db, close } = createTestDb());
	now = new Date(start);
	addWords(3, 12);
	sam = newChild('Sam');
});
afterEach(() => close());

describe('starting a session', () => {
	it('plans ten questions and serves the first', () => {
		expect(startPractice(db, sam, clock())).toBe('started');

		const [session] = sessions();
		expect(session.planJson).toHaveLength(10);
		expect(session.endedAt).toBeNull();
		expect(view()).toMatchObject({ kind: 'question', position: 1, total: 10 });
	});

	it('introduces no more new words than the setting allows', () => {
		playSession();

		expect(db.select().from(wordProgress).all()).toHaveLength(4);
	});

	it('takes new words only from the child’s own grade', () => {
		addWords(4, 12);
		playSession();

		const seen = db
			.select({ word: word.word })
			.from(wordProgress)
			.innerJoin(word, eq(word.id, wordProgress.wordId))
			.all();
		expect(seen.every((row) => row.word.startsWith('g3w'))).toBe(true);
	});

	it('carries on with the session in progress instead of starting another', () => {
		startPractice(db, sam, clock());
		answerNext(true);
		tick(10 * MINUTE);

		expect(startPractice(db, sam, clock())).toBe('resumed');
		expect(sessions()).toHaveLength(1);
		expect(view()).toMatchObject({ kind: 'question', position: 2 });
	});

	it('closes a session left alone for an hour and starts afresh', () => {
		startPractice(db, sam, clock());
		answerNext(true);
		const lastTouched = new Date(now);
		tick(61 * MINUTE);

		expect(practiceStatus(db, sam, now, CHICAGO)).toBe('ready');
		expect(startPractice(db, sam, clock())).toBe('started');

		const [old, fresh] = sessions();
		expect(old).toMatchObject({ completed: false, questionCount: 2 });
		expect(old.endedAt).toEqual(lastTouched);
		expect(fresh.endedAt).toBeNull();
	});

	it('says there is nothing to practice when there are no words', () => {
		db.update(wordList).set({ active: false }).run();

		expect(startPractice(db, sam, clock())).toBe('empty');
		expect(sessions()).toHaveLength(0);
	});

	it('skips words and lists the parent has turned off', () => {
		db.update(word).set({ active: false }).where(eq(word.word, 'g3w1')).run();
		for (let day = 0; day < 3; day++) {
			playSession();
			tick(DAY);
		}

		expect(progressOf('g3w1')).toBeUndefined();
	});
});

describe('answering', () => {
	beforeEach(() => {
		startPractice(db, sam, clock());
	});

	it('records a right answer and shows it marked', () => {
		const current = pending();
		const right = current.choicesJson.indexOf(current.correctChoice);
		tick(4000);

		expect(submitAnswer(db, sam.id, { questionId: current.id, choice: right }, clock())).toBe(
			'recorded'
		);

		expect(answers()).toMatchObject([
			{ questionId: current.id, chosen: current.correctChoice, isCorrect: true, isRetry: false }
		]);
		const shown = view();
		if (shown.kind !== 'feedback') throw new Error('expected feedback');
		expect(shown.feedback).toMatchObject({ correct: true, word: current.word });
		expect(shown.feedback.choices.filter((choice) => choice.state === 'correct')).toHaveLength(1);
		expect(shown.feedback.choices.filter((choice) => choice.state === 'dimmed')).toHaveLength(3);
	});

	it('records a wrong answer and shows both the pick and the right answer', () => {
		const current = pending();
		const right = current.choicesJson.indexOf(current.correctChoice);
		const wrong = (right + 1) % 4;

		submitAnswer(db, sam.id, { questionId: current.id, choice: wrong }, clock());

		expect(answers()).toMatchObject([{ chosen: current.choicesJson[wrong], isCorrect: false }]);
		const shown = view();
		if (shown.kind !== 'feedback') throw new Error('expected feedback');
		expect(shown.feedback.correct).toBe(false);
		expect(shown.feedback.choices[right].state).toBe('correct');
		expect(shown.feedback.choices[wrong].state).toBe('incorrect');
	});

	it('does not reveal the answer while the question is waiting', () => {
		const current = pending();
		const sent = JSON.stringify(view());

		expect(sent).not.toMatch(/correct/i);
		// The word is shown and so are four definitions, but nothing links the right one to it.
		expect(sent).toContain(current.word);
		expect(sent).not.toContain(`It was a ${current.word} day.`);
	});

	it('ignores a second answer to the same question', () => {
		const current = pending();
		const right = current.choicesJson.indexOf(current.correctChoice);
		submitAnswer(db, sam.id, { questionId: current.id, choice: (right + 1) % 4 }, clock());

		expect(submitAnswer(db, sam.id, { questionId: current.id, choice: right }, clock())).toBe(
			'stale'
		);
		expect(answers()).toHaveLength(1);
		expect(answers()[0].isCorrect).toBe(false);
	});

	it('ignores an answer to a question that is not the current one', () => {
		const first = pending();
		answerNext(true);

		expect(submitAnswer(db, sam.id, { questionId: first.id, choice: 0 }, clock())).toBe('stale');
		expect(submitAnswer(db, sam.id, { questionId: 99_999, choice: 0 }, clock())).toBe('stale');
		expect(answers()).toHaveLength(1);
	});

	it('rejects a missing or impossible choice without recording anything', () => {
		const current = pending();

		expect(submitAnswer(db, sam.id, { questionId: current.id }, clock())).toBe('invalid');
		expect(submitAnswer(db, sam.id, { questionId: current.id, choice: 7 }, clock())).toBe(
			'invalid'
		);
		expect(submitAnswer(db, sam.id, { questionId: current.id, choice: -1 }, clock())).toBe(
			'invalid'
		);
		expect(answers()).toHaveLength(0);
		expect(view().kind).toBe('question');
	});

	it('never lets one child answer another child’s question', () => {
		const mia = newChild('Mia');
		const samsQuestion = pending();
		startPractice(db, mia, clock());

		expect(submitAnswer(db, mia.id, { questionId: samsQuestion.id, choice: 0 }, clock())).toBe(
			'stale'
		);
		expect(answers()).toHaveLength(0);
		// Mia has no session at all to answer in if she has not started one.
		const zoe = newChild('Zoe');
		expect(submitAnswer(db, zoe.id, { questionId: samsQuestion.id, choice: 0 }, clock())).toBe(
			'stale'
		);
	});

	it('uses the browser’s thinking time when it is believable, and its own otherwise', () => {
		const first = pending();
		tick(8000);
		submitAnswer(db, sam.id, { questionId: first.id, choice: 0, responseMs: 6200 }, clock());
		tick();
		advance(db, sam, clock());

		// Claims to have taken ten minutes when only three seconds passed.
		const second = pending();
		tick(3000);
		submitAnswer(db, sam.id, { questionId: second.id, choice: 0, responseMs: 600_000 }, clock());

		expect(answers().map((row) => row.responseMs)).toEqual([6200, 3000]);
	});

	it('does not move on until the question has been answered', () => {
		expect(advance(db, sam, clock())).toBe('waiting');
		expect(view()).toMatchObject({ kind: 'question', position: 1 });
	});
});

describe('boxes', () => {
	it('puts a new word answered right in box 2 and one answered wrong in box 1, both due tomorrow', () => {
		startPractice(db, sam, clock());
		const first = pending().word;
		answerNext(true);
		const second = pending().word;
		answerNext(false);

		const tomorrow = new Date('2026-11-11T06:00:00Z'); // midnight in Chicago
		expect(progressOf(first)).toMatchObject({ box: 2, dueAt: tomorrow });
		expect(progressOf(second)).toMatchObject({ box: 1, dueAt: tomorrow });
	});

	it('does not move a word up for the second and third looks in the same session', () => {
		playSession();

		// Each new word was asked two or three times and always answered right.
		const boxes = db.select({ box: wordProgress.box }).from(wordProgress).all();
		expect(boxes).toEqual(Array(4).fill({ box: 2 }));
	});

	it('sends a word back to box 1 when a later look in the same session is wrong', () => {
		startPractice(db, sam, clock());
		const first = pending().word;
		answerNext(true);
		expect(progressOf(first)?.box).toBe(2);

		// Its second look is question 5.
		answerNext(true);
		answerNext(true);
		answerNext(true);
		expect(pending().word).toBe(first);
		answerNext(false);

		expect(progressOf(first)?.box).toBe(1);
	});

	it('moves a word up one box each time it comes back and is answered right', () => {
		playSession();
		const name = db
			.select({ word: word.word })
			.from(wordProgress)
			.innerJoin(word, eq(word.id, wordProgress.wordId))
			.all()[0].word;

		const boxes = [progressOf(name)!.box];
		for (const days of [1, 3, 7, 21]) {
			tick(days * DAY);
			playSession();
			boxes.push(progressOf(name)!.box);
		}

		expect(boxes).toEqual([2, 3, 4, 5, 5]);
		expect(progressOf(name)!.masteredAt).toBeInstanceOf(Date);
	});

	it('asks a word in a harder way as its box goes up', () => {
		startPractice(db, sam, clock());
		const name = pending().word;
		while (answerNext(true) === 'question');

		// How the word is first asked in each later session.
		const types: string[] = [];
		for (const days of [1, 3, 7, 21]) {
			tick(days * DAY);
			startPractice(db, sam, clock());
			let seen = false;
			do {
				const current = pending();
				if (!seen && current.word === name) {
					types.push(current.type);
					seen = true;
				}
			} while (answerNext(true) === 'question');
		}

		expect(types).toEqual(['word_to_def', 'def_to_word', 'cloze', 'spell']);
	});

	it('does not bring a word back before it is due', () => {
		playSession();
		tick(DAY);
		playSession(); // the four words are now in box 3, due in three days
		tick(DAY);
		startPractice(db, sam, clock());

		const [, , third] = sessions();
		const firstFour = new Set(
			db
				.select({ id: wordProgress.wordId })
				.from(wordProgress)
				.where(eq(wordProgress.box, 3))
				.all()
				.map((row) => row.id)
		);
		// The session leads with new words, not with the words that are waiting.
		expect(firstFour.has(third.planJson[0].wordId)).toBe(false);
	});
});

describe('a missed word', () => {
	it('is asked again later in the session, as a retry', () => {
		// The last question is the only look left at its word, so missing it adds a retry.
		const asked = playSession([10]);

		expect(asked).toBe(11);
		const all = answers();
		expect(all).toHaveLength(11);
		expect(all[9]).toMatchObject({ isCorrect: false });
		expect(all[10]).toMatchObject({ isCorrect: true, isRetry: true });

		const questions = db.select().from(question).orderBy(question.id).all();
		expect(questions[10].wordId).toBe(questions[9].wordId);
		expect(questions[10].type).toBe('word_to_def');
	});

	it('is not added again when it is already coming up', () => {
		// Question 1's word has a second look at question 5.
		expect(playSession([1])).toBe(10);
	});

	it('stays in box 1 even when the retry is right', () => {
		startPractice(db, sam, clock());
		for (let index = 0; index < 9; index++) answerNext(true);
		const last = pending().word;
		answerNext(false);
		answerNext(true); // the retry

		expect(progressOf(last)?.box).toBe(1);
	});
});

describe('finishing', () => {
	it('marks the session complete and counts its questions', () => {
		playSession();

		expect(sessions()).toMatchObject([{ completed: true, questionCount: 10 }]);
		expect(sessions()[0].endedAt).toEqual(now);
		expect(view().kind).toBe('none');
	});

	it('sums up the session with one result per question', () => {
		// Both missed words come up again anyway, so no retries are added.
		playSession([2, 5]);

		const summary = lastSummary(db, sam, now, CHICAGO)!;
		expect(summary.results).toEqual([true, false, true, true, false, true, true, true, true, true]);
		expect(summary.newWords).toBe(4);
		expect(summary.streak).toBe(1);
		expect(summary.canPracticeAgain).toBe(true);
	});

	it('includes retries in the results', () => {
		playSession([10]);

		expect(lastSummary(db, sam, now, CHICAGO)!.results).toHaveLength(11);
	});

	it('has no summary to show an hour later, or after stopping early', () => {
		playSession();
		tick(61 * MINUTE);
		expect(lastSummary(db, sam, now, CHICAGO)).toBeNull();

		const mia = newChild('Mia');
		startPractice(db, mia, clock());
		answerNext(true, mia);
		quit(db, mia, now);
		expect(lastSummary(db, mia, now, CHICAGO)).toBeNull();
	});

	it('stopping early keeps what was answered and ends the session unfinished', () => {
		startPractice(db, sam, clock());
		answerNext(true);
		answerNext(true);
		quit(db, sam, now);

		expect(sessions()).toMatchObject([{ completed: false, questionCount: 3 }]);
		expect(answers()).toHaveLength(2);
		expect(db.select().from(wordProgress).all()).toHaveLength(2);
		expect(practiceStatus(db, sam, now, CHICAGO)).toBe('ready');
	});
});

describe('time practiced', () => {
	it('adds up thinking and reading time', () => {
		startPractice(db, sam, clock());
		answerNext(true); // 5s thinking, 5s reading
		answerNext(true);

		expect(sessions()[0].activeMs).toBe(20_000);
	});

	it('counts at most a minute for any one gap, so walking away does not add up', () => {
		startPractice(db, sam, clock());
		const current = pending();
		tick(25 * MINUTE); // went to get a snack
		submitAnswer(db, sam.id, { questionId: current.id, choice: 0 }, clock());
		tick(10 * MINUTE);
		advance(db, sam, clock());

		expect(sessions()[0].activeMs).toBe(2 * MINUTE);
	});

	it('totals the day in the family’s time zone', () => {
		playSession(); // 100 seconds on Tuesday afternoon
		expect(activeMsToday(db, sam.id, now, CHICAGO)).toBe(100_000);

		// 11:30pm the same evening is still Tuesday in Chicago, though Wednesday in UTC.
		expect(activeMsToday(db, sam.id, new Date('2026-11-11T05:30:00Z'), CHICAGO)).toBe(100_000);
		expect(activeMsToday(db, sam.id, new Date('2026-11-11T06:30:00Z'), CHICAGO)).toBe(0);
	});
});

describe('daily limit', () => {
	beforeEach(() => {
		sam = { ...sam, settings: { ...DEFAULT_SETTINGS, dailyCapMinutes: 1 } };
	});

	it('stops new sessions once the limit is reached, until the next day', () => {
		playSession(); // 100 seconds, over the one-minute limit

		expect(practiceStatus(db, sam, now, CHICAGO)).toBe('capped');
		expect(startPractice(db, sam, clock())).toBe('capped');
		expect(lastSummary(db, sam, now, CHICAGO)?.canPracticeAgain).toBe(false);

		now = new Date('2026-11-11T14:00:00Z'); // the next morning
		expect(practiceStatus(db, sam, now, CHICAGO)).toBe('ready');
		expect(startPractice(db, sam, clock())).toBe('started');
	});

	it('lets a session that is under way finish', () => {
		startPractice(db, sam, clock());
		for (let index = 0; index < 7; index++) answerNext(true); // 70 seconds

		expect(practiceStatus(db, sam, now, CHICAGO)).toBe('resume');
		expect(answerNext(true)).toBe('question');
	});
});

describe('streak', () => {
	it('counts days in a row with a finished session', () => {
		expect(streak(db, sam.id, now, CHICAGO)).toBe(0);

		playSession();
		expect(streak(db, sam.id, now, CHICAGO)).toBe(1);

		tick(DAY);
		expect(streak(db, sam.id, now, CHICAGO)).toBe(1); // today is not over yet
		playSession();
		expect(streak(db, sam.id, now, CHICAGO)).toBe(2);

		tick(2 * DAY);
		expect(streak(db, sam.id, now, CHICAGO)).toBe(0); // a day was missed
	});

	it('does not count a session that was stopped early', () => {
		startPractice(db, sam, clock());
		answerNext(true);
		quit(db, sam, now);

		expect(streak(db, sam.id, now, CHICAGO)).toBe(0);
	});
});

describe('moving up a grade', () => {
	/** Puts the first `count` grade 3 words in box 4 for Sam. */
	function knowWell(count: number) {
		const words = db.select().from(word).limit(count).all();
		for (const entry of words) {
			db.insert(wordProgress)
				.values({
					childId: sam.id,
					wordId: entry.id,
					box: 4,
					dueAt: new Date(now.getTime() + 30 * DAY),
					firstSeenAt: start
				})
				.run();
		}
	}
	const grade = () => db.select().from(child).where(eq(child.id, sam.id)).get()!.grade;

	it('reports the share of the grade that is well known', () => {
		expect(gradeProgress(db, sam.id, 3)).toBe(0);
		knowWell(9);
		expect(gradeProgress(db, sam.id, 3)).toBe(0.75);
		expect(gradeProgress(db, sam.id, 4)).toBe(0);
	});

	it('happens at the end of a session at 80%, when set to automatic', () => {
		addWords(4, 12);
		sam = { ...sam, settings: { ...DEFAULT_SETTINGS, autoUnlockNextGrade: true } };
		knowWell(10); // 10 of 12 is 83%

		playSession();

		expect(grade()).toBe(4);
	});

	it('does not happen below 80%', () => {
		sam = { ...sam, settings: { ...DEFAULT_SETTINGS, autoUnlockNextGrade: true } };
		knowWell(9);

		playSession();

		expect(grade()).toBe(3);
	});

	it('does not happen unless the parent chose automatic', () => {
		knowWell(10);

		playSession();

		expect(grade()).toBe(3);
	});
});
