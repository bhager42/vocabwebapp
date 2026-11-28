import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	createChild,
	getChild,
	DEFAULT_SETTINGS,
	setReadingGrade,
	type Child
} from './children.ts';
import { loadReading } from './content/load.ts';
import type { GradeStories, Story, StoryQuestion } from './content/reading.ts';
import { seedStories } from './content/seed-reading.ts';
import type { Db } from './db/client.ts';
import {
	answer,
	child,
	practiceSession,
	question,
	readingAnswer,
	readingAttempt,
	readingQuestion,
	readingStory,
	wordProgress
} from './db/schema.ts';
import { practiceStatus } from './practice.ts';
import {
	advanceReading,
	answerReading,
	attemptDetail,
	gradeEnd,
	gradeFinished,
	lastReadingSummary,
	listAttempts,
	listStories,
	nextReadingGrade,
	nextStory,
	READING_GAP_CAP_MS,
	readingFigures,
	storiesByGrade,
	readingStatus,
	readingView,
	readiness,
	retestsLeft,
	setStoryActive,
	STALE_MS,
	startReading,
	startRetest,
	type Clock
} from './reading.ts';
import { createTestDb } from './test-db.ts';

const CHICAGO = 'America/Chicago';
const start = new Date('2026-11-10T22:00:00Z');

let db: Db;
let close: () => void;
let now: Date;
let sam: Child;

const rng = () => 0.3;
const clock = (): Clock => ({ now, timeZone: CHICAGO, rng });
const tick = (ms = 10_000) => (now = new Date(now.getTime() + ms));
const fresh = () => getChild(db, sam.id)!;

// Small made-up stories: each has two literal, two inference and one sequence question,
// whose right answer is "right N" and wrong answers "wrong N a/b/c".
const q = (kind: StoryQuestion['kind'], n: number): StoryQuestion => ({
	kind,
	prompt: `Question ${n}?`,
	correct: `right ${n}`,
	wrong: [`wrong ${n} a`, `wrong ${n} b`, `wrong ${n} c`],
	explanation: `Because ${n}.`,
	evidence: ['x']
});
const story = (id: string): Story => ({
	id,
	title: `Title ${id}`,
	paragraphs: [`First part of ${id}.`, `Second part of ${id}.`],
	questions: [
		q('literal', 1),
		q('literal', 2),
		q('inference', 3),
		q('inference', 4),
		q('sequence', 5)
	]
});
const content = (grades: Record<number, string[]>): GradeStories[] =>
	Object.entries(grades).map(([grade, ids]) => ({ grade: Number(grade), stories: ids.map(story) }));

type Table =
	| typeof question
	| typeof answer
	| typeof practiceSession
	| typeof wordProgress
	| typeof readingQuestion;
const count = (table: Table): number =>
	db
		.select({ n: sql<number>`count(*)` })
		.from(table)
		.get()!.n;

/** The served reading_answer row of the question on screen. */
function onScreen() {
	const view = readingView(db, sam.id, now);
	if (view.kind !== 'question') throw new Error(`expected a question, got ${view.kind}`);
	const row = db.select().from(readingAnswer).where(eq(readingAnswer.id, view.question.id)).get()!;
	return { view, right: view.question.choices.indexOf(row.correctChoice), row };
}

/** Answers the question on screen, right or wrong, and presses Next. */
function answerAndNext(right: boolean) {
	const { view, right: index } = onScreen();
	tick();
	expect(
		answerReading(
			db,
			sam.id,
			{ questionId: view.question.id, choice: right ? index : (index + 1) % 4 },
			now
		)
	).toBe('recorded');
	tick();
	return advanceReading(db, fresh(), clock());
}

/** Reads a whole story, getting `right` of its five questions right (the first ones). */
function readStory(right = 5) {
	expect(startReading(db, fresh(), clock())).toBe('started');
	let result: string = 'question';
	for (let index = 0; result === 'question'; index++) result = answerAndNext(index < right);
	expect(result).toBe('done');
}

beforeEach(() => {
	({ db, close } = createTestDb());
	now = start;
	const made = createChild(db, { name: 'Sam', grade: 3 }, start);
	if (!made.ok) throw new Error('setup');
	sam = made.child;
});

afterEach(() => close());

describe('seedStories', () => {
	it('loads the shipped stories, and a second run changes nothing', () => {
		const shipped = loadReading(path.resolve('content/reading'));
		const stories = shipped.reduce((total, grade) => total + grade.stories.length, 0);
		expect(stories).toBeGreaterThanOrEqual(15);
		const first = seedStories(db, shipped);
		expect(first.inserted).toBe(stories);
		expect(count(readingQuestion)).toBe(stories * 5);
		expect(seedStories(db, shipped)).toEqual({
			inserted: 0,
			updated: 0,
			unchanged: stories,
			retired: 0
		});
	});

	it('updates in place, keeps the parent’s switch, and retires what is gone', () => {
		seedStories(db, content({ 3: ['a', 'b'] }));
		const ids = db
			.select({ id: readingStory.id, slug: readingStory.slug })
			.from(readingStory)
			.all();
		const b = ids.find((row) => row.slug === 'b')!.id;
		setStoryActive(db, b, false);

		const changed = content({ 3: ['a', 'b'] });
		changed[0].stories[0].title = 'New title';
		changed[0].stories[1].questions = changed[0].stories[1].questions.slice(0, 4);
		expect(seedStories(db, changed)).toEqual({ inserted: 0, updated: 2, unchanged: 0, retired: 0 });
		expect(
			db.select({ id: readingStory.id, slug: readingStory.slug }).from(readingStory).all()
		).toEqual(ids);
		expect(listStories(db).find((row) => row.slug === 'b')?.active).toBe(false);
		const bQuestions = db
			.select()
			.from(readingQuestion)
			.where(eq(readingQuestion.storyId, b))
			.all();
		expect(bQuestions.map((row) => row.active)).toEqual([true, true, true, true, false]);

		expect(seedStories(db, content({ 3: ['b'] })).retired).toBe(1);
		expect(listStories(db).find((row) => row.slug === 'a')?.active).toBe(false);
	});
});

describe('choosing a story', () => {
	beforeEach(() => {
		seedStories(db, content({ 3: ['a', 'b'], 4: ['c'] }));
	});

	const slugOf = (id: number | null) =>
		db.select({ slug: readingStory.slug }).from(readingStory).where(eq(readingStory.id, id!)).get()
			?.slug;

	it('goes through unread stories in order, then stops for a grown-up', () => {
		expect(slugOf(nextStory(db, sam.id, 3))).toBe('a');
		readStory();
		expect(slugOf(nextStory(db, sam.id, 3))).toBe('b');
		expect(gradeFinished(db, sam.id, 3)).toBe(false);
		tick(60_000);
		readStory();
		expect(nextStory(db, sam.id, 3)).toBeNull();
		expect(gradeFinished(db, sam.id, 3)).toBe(true);
		expect(readingStatus(db, fresh(), now, CHICAGO)).toBe('finished');
		expect(startReading(db, fresh(), clock())).toBe('finished');
		expect(lastReadingSummary(db, fresh(), now, CHICAGO)).toMatchObject({
			canReadAgain: false,
			finishedGrade: 3
		});
	});

	it('starts again with a story added to the grade later', () => {
		readStory();
		tick(60_000);
		readStory();
		seedStories(db, content({ 3: ['a', 'b', 'n'], 4: ['c'] }));
		expect(slugOf(nextStory(db, sam.id, 3))).toBe('n');
		expect(readingStatus(db, fresh(), now, CHICAGO)).toBe('ready');
	});

	it('lets the parent have the stories with a wrong answer read again', () => {
		readStory(4); // a: one wrong
		tick(60_000);
		readStory(5); // b: all right
		tick(60_000);
		// Nothing to read again before the grade is finished... and here it is.
		expect(gradeEnd(db, sam.id, 3)).toEqual({
			grade: 3,
			stories: 2,
			withMistakes: [{ id: expect.any(Number), title: 'Title a' }]
		});

		expect(startRetest(db, sam.id, 3, now)).toBe(1);
		expect(gradeEnd(db, sam.id, 3)).toBeNull();
		expect(retestsLeft(db, sam.id, 3)).toBe(1);
		expect(readingStatus(db, fresh(), now, CHICAGO)).toBe('ready');
		expect(slugOf(nextStory(db, sam.id, 3))).toBe('a');

		readStory(5); // a again, all right this time
		expect(retestsLeft(db, sam.id, 3)).toBe(0);
		expect(gradeEnd(db, sam.id, 3)).toMatchObject({ withMistakes: [] });
		expect(readingStatus(db, fresh(), now, CHICAGO)).toBe('finished');
	});

	it('keeps a story with a wrong answer on the re-read for next time', () => {
		readStory(4);
		tick(60_000);
		readStory(5);
		tick(60_000);
		startRetest(db, sam.id, 3, now);
		readStory(3); // a again, two wrong this time
		expect(gradeEnd(db, sam.id, 3)!.withMistakes.map((story) => story.title)).toEqual(['Title a']);
	});

	it('does nothing when asked to re-read before the grade is finished', () => {
		readStory(2);
		expect(startRetest(db, sam.id, 3, now)).toBe(0);
		expect(retestsLeft(db, sam.id, 3)).toBe(0);
	});

	it('forgets the stories to read again when the reading grade changes', () => {
		readStory(4);
		tick(60_000);
		readStory(4);
		startRetest(db, sam.id, 3, now);
		expect(retestsLeft(db, sam.id, 3)).toBe(2);
		setReadingGrade(db, sam.id, 4);
		setReadingGrade(db, sam.id, 3);
		expect(retestsLeft(db, sam.id, 3)).toBe(0);
	});

	it('skips stories that are switched off, and says when there are none', () => {
		const [a, b] = listStories(db);
		setStoryActive(db, a.id, false);
		expect(nextStory(db, sam.id, 3)).toBe(b.id);
		setStoryActive(db, b.id, false);
		expect(nextStory(db, sam.id, 3)).toBeNull();
		expect(readingStatus(db, fresh(), now, CHICAGO)).toBe('none');
		expect(startReading(db, fresh(), clock())).toBe('empty');
	});

	it('knows the next grade that has stories', () => {
		expect(nextReadingGrade(db, 3)).toBe(4);
		expect(nextReadingGrade(db, 4)).toBeNull();
	});
});

describe('reading a story', () => {
	beforeEach(() => {
		seedStories(db, content({ 3: ['a', 'b'] }));
	});

	it('shows the story and one question at a time, with no answer until it is given', () => {
		expect(readingStatus(db, fresh(), now, CHICAGO)).toBe('ready');
		startReading(db, fresh(), clock());
		const { view } = onScreen();
		expect(view).toMatchObject({
			kind: 'question',
			story: {
				title: 'Title a',
				paragraphs: ['First part of a.', 'Second part of a.'],
				grade: 3
			},
			position: 1,
			total: 5,
			question: { prompt: 'Question 1?' }
		});
		expect(view.question.choices.sort()).toEqual([
			'right 1',
			'wrong 1 a',
			'wrong 1 b',
			'wrong 1 c'
		]);
		expect(JSON.stringify(view)).not.toMatch(/Because|correct|explanation/);
	});

	it('gives feedback with the explanation after each answer', () => {
		startReading(db, fresh(), clock());
		const { view, right } = onScreen();
		answerReading(db, sam.id, { questionId: view.question.id, choice: (right + 1) % 4 }, now);
		const feedback = readingView(db, sam.id, now);
		expect(feedback).toMatchObject({
			kind: 'feedback',
			last: false,
			feedback: { correct: false, answer: 'right 1', explanation: 'Because 1.' }
		});
		if (feedback.kind !== 'feedback') throw new Error();
		expect(feedback.feedback.choices.map((choice) => choice.state).sort()).toEqual([
			'correct',
			'dimmed',
			'dimmed',
			'incorrect'
		]);
	});

	it('finishes with a summary', () => {
		readStory(3);
		expect(lastReadingSummary(db, fresh(), now, CHICAGO)).toEqual({
			title: 'Title a',
			right: 3,
			total: 5,
			canReadAgain: true,
			finishedGrade: null
		});
		expect(readingStatus(db, fresh(), now, CHICAGO)).toBe('ready');
	});

	it('ignores a stale, empty or other child’s answer', () => {
		const other = createChild(db, { name: 'Mia', grade: 3 }, start);
		if (!other.ok) throw new Error();
		startReading(db, fresh(), clock());
		const { view } = onScreen();
		expect(
			answerReading(db, other.child.id, { questionId: view.question.id, choice: 0 }, now)
		).toBe('stale');
		expect(answerReading(db, sam.id, { questionId: view.question.id + 1, choice: 0 }, now)).toBe(
			'stale'
		);
		expect(answerReading(db, sam.id, { questionId: view.question.id }, now)).toBe('invalid');
		expect(answerReading(db, sam.id, { questionId: view.question.id, choice: 7 }, now)).toBe(
			'invalid'
		);
		expect(advanceReading(db, fresh(), clock())).toBe('waiting');
		expect(answerReading(db, sam.id, { questionId: view.question.id, choice: 0 }, now)).toBe(
			'recorded'
		);
		expect(answerReading(db, sam.id, { questionId: view.question.id, choice: 0 }, now)).toBe(
			'stale'
		);
	});

	it('picks up where the child stopped, and closes a story left for a week', () => {
		startReading(db, fresh(), clock());
		answerAndNext(true);
		const second = onScreen().view.question.id;
		tick(2 * 24 * 60 * 60_000);
		expect(readingStatus(db, fresh(), now, CHICAGO)).toBe('resume');
		expect(startReading(db, fresh(), clock())).toBe('resumed');
		expect(onScreen().view.question.id).toBe(second);

		tick(STALE_MS);
		expect(readingView(db, sam.id, now)).toEqual({ kind: 'none' });
		expect(listAttempts(db, sam.id, now)[0].state).toBe('unfinished');
	});

	it('counts reading time with each gap capped, toward the daily limit', () => {
		startReading(db, fresh(), clock());
		const { view, right } = onScreen();
		tick(20 * 60_000); // twenty minutes on the first question counts as five
		answerReading(db, sam.id, { questionId: view.question.id, choice: right }, now);
		const attempt = db.select().from(readingAttempt).get()!;
		expect(attempt.activeMs).toBe(READING_GAP_CAP_MS);

		db.update(child)
			.set({ settingsJson: { ...DEFAULT_SETTINGS, dailyCapMinutes: 5 } })
			.where(eq(child.id, sam.id))
			.run();
		// The story in progress can be finished, but the limit now applies to new ones.
		expect(practiceStatus(db, fresh(), now, CHICAGO)).toBe('capped');
		db.update(readingAttempt).set({ endedAt: now, completed: true }).run();
		expect(readingStatus(db, fresh(), now, CHICAGO)).toBe('capped');
		expect(startReading(db, fresh(), clock())).toBe('capped');
	});

	it('changes no word practice data', () => {
		const before = [question, answer, practiceSession, wordProgress].map(count);
		readStory(2);
		expect([question, answer, practiceSession, wordProgress].map(count)).toEqual(before);
	});
});

describe('reading grade', () => {
	beforeEach(() => {
		seedStories(db, content({ 3: ['a', 'b', 'c', 'd', 'e', 'f'], 4: ['g'] }));
	});

	it('is ready after five stories at 80%, with 70% on inference', () => {
		for (let index = 0; index < 4; index++) {
			readStory(5);
			tick(60_000);
		}
		expect(readiness(db, sam.id, 3)).toMatchObject({ stories: 4, ready: false });
		// Three of five right in the last story (one inference and the sequence question
		// missed): 23 of 25 overall, and 9 of 10 inference answers over the five stories.
		readStory(3);
		const result = readiness(db, sam.id, 3);
		expect(result.stories).toBe(5);
		expect(result.share).toBeCloseTo(23 / 25);
		expect(result.inferenceShare).toBeCloseTo(9 / 10);
		expect(result.ready).toBe(true);
		// Moving up is the parent's choice unless set to automatic.
		expect(fresh().readingGrade).toBe(3);
	});

	it('is not ready when inference answers lag behind', () => {
		for (let index = 0; index < 5; index++) {
			// Right on the two literal questions only... then the sequence one is wrong too.
			readStory(2);
			tick(60_000);
		}
		expect(readiness(db, sam.id, 3)).toMatchObject({ ready: false, inferenceShare: 0 });
	});

	it('moves up by itself when the parent chose automatic', () => {
		db.update(child)
			.set({ settingsJson: { ...DEFAULT_SETTINGS, autoUnlockReadingGrade: true } })
			.where(eq(child.id, sam.id))
			.run();
		for (let index = 0; index < 5; index++) {
			readStory(5);
			tick(60_000);
		}
		expect(fresh().readingGrade).toBe(4);
	});
});

describe('figures for the parent', () => {
	beforeEach(() => {
		seedStories(db, content({ 3: ['a', 'b'] }));
	});

	it('split stated and inferred answers', () => {
		readStory(3); // literal ✓✓, inference ✓✗, sequence ✗
		tick(60_000);
		startReading(db, fresh(), clock());
		answerAndNext(false); // literal ✗, then stopped
		const figures = readingFigures(db, { childId: sam.id, since: null, now, timeZone: CHICAGO });
		expect(figures).toMatchObject({
			started: 2,
			finished: 1,
			overall: { asked: 6, correct: 3 },
			literal: { asked: 3, correct: 2 },
			inference: { asked: 2, correct: 1, share: 0.5 },
			other: { asked: 1, correct: 0 }
		});
	});

	it('count the stories finished at each grade, each story once', () => {
		seedStories(db, content({ 3: ['a', 'b'], 4: ['c'] }));
		readStory(4); // a
		tick(60_000);
		readStory(5); // b
		tick(60_000);
		startRetest(db, sam.id, 3, now);
		readStory(3); // a again, asked for by the parent

		expect(storiesByGrade(db, sam.id)).toEqual([
			{ grade: 3, stories: 2, finished: 2, right: { asked: 15, correct: 12, share: 0.8 } },
			{ grade: 4, stories: 1, finished: 0, right: { asked: 0, correct: 0, share: null } }
		]);
	});

	it('count nothing for a child who has not read', () => {
		readStory();
		const other = createChild(db, { name: 'Mia', grade: 3 }, start);
		if (!other.ok) throw new Error('setup');
		expect(storiesByGrade(db, other.child.id).map((grade) => grade.finished)).toEqual([0]);
	});

	it('lists attempts and shows one in full, only to its own child', () => {
		readStory(4);
		const [attempt] = listAttempts(db, sam.id, now);
		expect(attempt).toMatchObject({
			title: 'Title a',
			state: 'finished',
			right: 4,
			answered: 5,
			total: 5
		});
		const detail = attemptDetail(db, sam.id, attempt.id)!;
		expect(detail.answers).toHaveLength(5);
		expect(detail.answers[4]).toMatchObject({
			kind: 'sequence',
			correct: 'right 5',
			isCorrect: false
		});
		expect(detail.answers[4].chosen).toMatch(/^wrong 5/);

		const other = createChild(db, { name: 'Mia', grade: 3 }, start);
		if (!other.ok) throw new Error();
		expect(attemptDetail(db, other.child.id, attempt.id)).toBeNull();
	});
});
