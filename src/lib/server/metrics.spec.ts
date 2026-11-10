import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChild, DEFAULT_SETTINGS } from './children.ts';
import type { Db } from './db/client.ts';
import { answer, practiceSession, question, word, wordList } from './db/schema.ts';
import {
	accuracy,
	accuracyByType,
	dailyActivity,
	groupByWeek,
	guessing,
	practiceDays,
	responseTimes,
	retention,
	scopeFor,
	sessionCounts,
	timeOfDay,
	timePracticed,
	troubleWords,
	wordStatus,
	type Period
} from './metrics.ts';
import { advance, startPractice, submitAnswer } from './practice.ts';
import { createTestDb } from './test-db.ts';
import { buildFixture, CHICAGO, NOW, type Fixture } from './test-fixture.ts';

// See test-fixture.ts for the practice history every expected number here comes from.

let db: Db;
let close: () => void;
let fixture: Fixture;

beforeEach(() => {
	({ db, close } = createTestDb());
	fixture = buildFixture(db);
});
afterEach(() => close());

const sam = (period: Period) => scopeFor(fixture.sam, period, NOW, CHICAGO);

describe('scopeFor', () => {
	it('"7d" is today and the six days before, from local midnight', () => {
		// Midnight on Wednesday 4 November in Chicago is 06:00 UTC.
		expect(sam('7d').since).toEqual(new Date('2026-11-04T06:00:00Z'));
	});

	it('"30d" reaches back across the clock change', () => {
		// 12 October is still on daylight saving time: midnight is 05:00 UTC.
		expect(sam('30d').since).toEqual(new Date('2026-10-12T05:00:00Z'));
	});

	it('"all" has no start', () => {
		expect(sam('all').since).toBeNull();
	});
});

describe('accuracy', () => {
	it('counts first attempts, and retries apart', () => {
		// First attempts: S1 ✓✗✓, S2 ✓✗✓, S3 ✗✓, S4 ✗✓ = 6 right of 10.
		expect(accuracy(db, sam('all'))).toEqual({
			firstAttempts: 10,
			firstCorrect: 6,
			share: 0.6,
			retries: 2,
			retriesCorrect: 1
		});
	});

	it('keeps to the period', () => {
		// S2, S3 and S4 only: ✓✗✓, ✗✓, ✗✓ = 4 right of 7, and one retry, wrong.
		expect(accuracy(db, sam('7d'))).toEqual({
			firstAttempts: 7,
			firstCorrect: 4,
			share: 4 / 7,
			retries: 1,
			retriesCorrect: 0
		});
	});

	it('has no share when nothing was answered', () => {
		const result = createChild(db, { name: 'Zed', grade: 3 });
		if (!result.ok) throw new Error();
		expect(accuracy(db, scopeFor(result.child.id, 'all', NOW, CHICAGO)).share).toBeNull();
	});

	it("never includes another child's answers", () => {
		expect(accuracy(db, scopeFor(fixture.mia, 'all', NOW, CHICAGO))).toMatchObject({
			firstAttempts: 1,
			firstCorrect: 1
		});
	});
});

describe('dailyActivity', () => {
	it('has one entry per day of the period, practiced or not', () => {
		const days = dailyActivity(db, sam('7d'));
		expect(days.map((entry) => entry.day)).toEqual([
			'2026-11-04',
			'2026-11-05',
			'2026-11-06',
			'2026-11-07',
			'2026-11-08',
			'2026-11-09',
			'2026-11-10'
		]);
		expect(days[0]).toEqual({
			day: '2026-11-04',
			firstAttempts: 3,
			firstCorrect: 2,
			accuracy: 2 / 3,
			activeMs: 240_000,
			sessions: 1
		});
		expect(days[1]).toEqual({
			day: '2026-11-05',
			firstAttempts: 0,
			firstCorrect: 0,
			accuracy: null,
			activeMs: 0,
			sessions: 0
		});
		expect(days[5]).toMatchObject({ firstAttempts: 2, firstCorrect: 1, activeMs: 60_000 });
		expect(days[6]).toMatchObject({ firstAttempts: 2, firstCorrect: 1, activeMs: 30_000 });
	});

	it('for all time starts on the day of the first session', () => {
		const days = dailyActivity(db, sam('all'));
		// 20 October to 10 November is 22 days.
		expect(days).toHaveLength(22);
		expect(days[0]).toMatchObject({ day: '2026-10-20', firstAttempts: 3, firstCorrect: 2 });
		expect(days.at(-1)!.day).toBe('2026-11-10');
	});

	it('puts an evening session on the local day, not the UTC one', () => {
		// 9pm on 9 November in Chicago is already 10 November in UTC.
		const session = db
			.insert(practiceSession)
			.values({
				childId: fixture.sam,
				startedAt: new Date('2026-11-10T03:00:00Z'),
				endedAt: new Date('2026-11-10T03:05:00Z'),
				activeMs: 120_000,
				completed: true
			})
			.returning()
			.get();
		const asked = db
			.insert(question)
			.values({
				practiceSessionId: session.id,
				wordId: fixture.words.w6,
				type: 'word_to_def',
				choicesJson: [],
				correctChoice: 'x',
				servedAt: new Date('2026-11-10T03:00:00Z')
			})
			.returning()
			.get();
		db.insert(answer)
			.values({
				questionId: asked.id,
				chosen: 'x',
				isCorrect: true,
				responseMs: 1000,
				answeredAt: new Date('2026-11-10T03:00:05Z')
			})
			.run();

		const monday = dailyActivity(db, sam('7d'))[5];
		expect(monday).toMatchObject({
			day: '2026-11-09',
			firstAttempts: 3,
			firstCorrect: 2,
			activeMs: 180_000,
			sessions: 2
		});
	});

	it('is empty for a child who has never practiced, over all time', () => {
		const result = createChild(db, { name: 'Zed', grade: 3 });
		if (!result.ok) throw new Error();
		expect(dailyActivity(db, scopeFor(result.child.id, 'all', NOW, CHICAGO))).toEqual([]);
		expect(dailyActivity(db, scopeFor(result.child.id, '7d', NOW, CHICAGO))).toHaveLength(7);
	});
});

describe('groupByWeek', () => {
	it('adds days up into weeks that start on Monday', () => {
		const weeks = groupByWeek(dailyActivity(db, sam('7d')));
		// 4 to 8 November fall in the week of Monday 2 November; 9 and 10 in the next.
		expect(weeks).toEqual([
			{
				day: '2026-11-02',
				firstAttempts: 3,
				firstCorrect: 2,
				accuracy: 2 / 3,
				activeMs: 240_000,
				sessions: 1
			},
			{
				day: '2026-11-09',
				firstAttempts: 4,
				firstCorrect: 2,
				accuracy: 0.5,
				activeMs: 90_000,
				sessions: 2
			}
		]);
	});

	it('leaves a week without practice without an accuracy', () => {
		const days = dailyActivity(db, sam('all'));
		// The week of 26 October has no practice at all.
		expect(groupByWeek(days).find((week) => week.day === '2026-10-26')).toMatchObject({
			firstAttempts: 0,
			accuracy: null
		});
	});
});

describe('timePracticed', () => {
	it('adds up the active time of the sessions in the period', () => {
		expect(timePracticed(db, sam('all'))).toBe(630_000);
		expect(timePracticed(db, sam('7d'))).toBe(330_000);
	});

	it('counts a long pause as one minute at most', () => {
		// A real session, played through practice.ts, for a new child.
		const list = db.select().from(wordList).all()[0];
		expect(list.grade).toBe(3);
		const result = createChild(db, { name: 'Zed', grade: 3 }, NOW);
		if (!result.ok) throw new Error();
		const zed = { id: result.child.id, grade: 3, settings: DEFAULT_SETTINGS };
		const at = (ms: number) => new Date(NOW.getTime() + ms);
		const clock = (ms: number) => ({ now: at(ms), timeZone: CHICAGO, rng: () => 0.5 });

		expect(startPractice(db, zed, clock(0))).toBe('started');
		const first = db
			.select({ id: question.id })
			.from(question)
			.innerJoin(practiceSession, eq(practiceSession.id, question.practiceSessionId))
			.where(eq(practiceSession.childId, zed.id))
			.get()!;

		// Five minutes staring out of the window, then an answer: counts as one minute.
		expect(submitAnswer(db, zed.id, { questionId: first.id, choice: 0 }, clock(300_000))).toBe(
			'recorded'
		);
		// Ten seconds reading the feedback: counts in full.
		expect(advance(db, zed, clock(310_000))).toBe('question');

		const scope = scopeFor(zed.id, '7d', at(310_000), CHICAGO);
		expect(timePracticed(db, scope)).toBe(70_000);
		expect(dailyActivity(db, scope).at(-1)).toMatchObject({ activeMs: 70_000, sessions: 1 });
	});
});

describe('practiceDays', () => {
	it('counts days with a finished session', () => {
		// Finished: 20 October and 4 November. 9 and 10 November were not finished.
		expect(practiceDays(db, sam('all'))).toEqual({
			daysPracticed: 2,
			currentStreak: 0,
			longestStreak: 1,
			lastDay: '2026-11-04'
		});
		expect(practiceDays(db, sam('7d')).daysPracticed).toBe(1);
	});

	it('reports the current and the longest streak', () => {
		const finish = (day: string) =>
			db
				.insert(practiceSession)
				.values({
					childId: fixture.sam,
					startedAt: new Date(`${day}T22:00:00Z`),
					endedAt: new Date(`${day}T22:05:00Z`),
					completed: true
				})
				.run();
		// 3, (4), 5, 6 November make four in a row; 9 and 10 November make two, up to today.
		for (const day of ['2026-11-03', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10']) {
			finish(day);
		}
		expect(practiceDays(db, sam('7d'))).toEqual({
			daysPracticed: 5,
			currentStreak: 2,
			longestStreak: 4,
			lastDay: '2026-11-10'
		});
	});
});

describe('sessionCounts', () => {
	it('splits sessions into finished, stopped and going on now', () => {
		expect(sessionCounts(db, sam('all'))).toEqual({
			started: 4,
			completed: 2,
			abandoned: 1,
			inProgress: 1
		});
		expect(sessionCounts(db, sam('7d'))).toMatchObject({ started: 3, completed: 1 });
	});

	it('counts an open session as stopped once it can no longer be resumed', () => {
		// S4 was last touched at 3:50pm; at 5pm it is more than an hour old.
		const later = scopeFor(fixture.sam, 'all', new Date('2026-11-10T23:00:00Z'), CHICAGO);
		expect(sessionCounts(db, later)).toEqual({
			started: 4,
			completed: 2,
			abandoned: 2,
			inProgress: 0
		});
	});
});

describe('wordStatus', () => {
	it('counts the words at each stage, per grade', () => {
		// Grade 3: w1, w2, w5 in boxes 1 to 3; w3 in box 4; w4 mastered; w6 to w10 not
		// started. w11 is switched off and not counted.
		expect(wordStatus(db, fixture.sam, 3)).toEqual([
			{ grade: 3, total: 10, fresh: 5, learning: 3, almost: 1, mastered: 1, known: 0.2 }
		]);
	});

	it('includes a higher grade once it is the child’s grade', () => {
		expect(wordStatus(db, fixture.sam, 4)).toEqual([
			expect.objectContaining({ grade: 3 }),
			{ grade: 4, total: 5, fresh: 5, learning: 0, almost: 0, mastered: 0, known: 0 }
		]);
	});

	it("is each child's own", () => {
		expect(wordStatus(db, fixture.mia, 3)).toEqual([
			{ grade: 3, total: 10, fresh: 9, learning: 1, almost: 0, mastered: 0, known: 0 }
		]);
	});

	it('leaves out words in a list that is switched off', () => {
		db.update(wordList).set({ active: false }).where(eq(wordList.grade, 3)).run();
		expect(wordStatus(db, fixture.sam, 3)).toEqual([]);
	});
});

describe('troubleWords', () => {
	it('lists missed words, worst first, with what they were mixed up with', () => {
		const { words } = fixture;
		expect(troubleWords(db, sam('all'))).toEqual([
			// w2: asked 4 times, wrong 3; picked w3's meaning twice and w5's once.
			{
				wordId: words.w2,
				word: 'w2',
				definition: 'meaning of w2',
				asked: 4,
				wrong: 3,
				confusedWith: 'w3',
				confusedTimes: 2
			},
			// w5 and w3 were each wrong once; w5 was wrong every time it was asked.
			{
				wordId: words.w5,
				word: 'w5',
				definition: 'meaning of w5',
				asked: 1,
				wrong: 1,
				confusedWith: 'gw5',
				confusedTimes: 1
			},
			{
				wordId: words.w3,
				word: 'w3',
				definition: 'meaning of w3',
				asked: 2,
				wrong: 1,
				confusedWith: 'w1',
				confusedTimes: 1
			}
		]);
	});

	it('keeps to the period and to the limit', () => {
		// Since 4 November w2 was asked twice and wrong both times.
		expect(troubleWords(db, sam('7d'), 1)).toEqual([
			expect.objectContaining({ word: 'w2', asked: 2, wrong: 2 })
		]);
	});
});

describe('retention', () => {
	it('is the accuracy on words not seen for 7 days or more', () => {
		// S2: w1 ✓ and w2 ✗, both last seen 15 days before. S3: w3 ✗, last seen 20 days
		// before. Not counted: w4 in S3 (5 days), w1 in S4 (6 days), and the retry of w2.
		expect(retention(db, sam('all'))).toEqual({ asked: 3, correct: 1, share: 1 / 3 });
	});

	it('looks back before the period to see when a word was last seen', () => {
		expect(retention(db, sam('7d'))).toEqual({ asked: 3, correct: 1, share: 1 / 3 });
	});

	it('counts a gap of exactly 7 days, but not a second less', () => {
		const ask = (name: string, at: string) => {
			const session = db
				.insert(practiceSession)
				.values({ childId: fixture.sam, startedAt: new Date(at), endedAt: new Date(at) })
				.returning()
				.get();
			const asked = db
				.insert(question)
				.values({
					practiceSessionId: session.id,
					wordId: fixture.words[name],
					type: 'word_to_def',
					choicesJson: [],
					correctChoice: 'x',
					servedAt: new Date(at)
				})
				.returning()
				.get();
			db.insert(answer)
				.values({
					questionId: asked.id,
					chosen: 'x',
					isCorrect: true,
					responseMs: 1000,
					answeredAt: new Date(at)
				})
				.run();
		};
		ask('w7', '2026-11-01T12:00:00Z');
		ask('w7', '2026-11-08T12:00:00Z'); // exactly 7 days later
		ask('w8', '2026-11-01T12:00:00Z');
		ask('w8', '2026-11-08T11:59:59Z'); // one second short

		expect(retention(db, sam('all'))).toEqual({ asked: 4, correct: 2, share: 0.5 });
	});
});

describe('accuracyByType', () => {
	it('gives first-attempt accuracy for each kind of question', () => {
		expect(accuracyByType(db, sam('all'))).toEqual([
			// S1 ✓✗✓, S2 ✗✓, S3 ✓.
			{ type: 'word_to_def', firstAttempts: 6, firstCorrect: 4, share: 4 / 6 },
			// S2 w1 ✓, S3 w3 ✗.
			{ type: 'def_to_word', firstAttempts: 2, firstCorrect: 1, share: 0.5 },
			{ type: 'cloze', firstAttempts: 1, firstCorrect: 1, share: 1 },
			{ type: 'spell', firstAttempts: 1, firstCorrect: 0, share: 0 }
		]);
	});

	it('lists a kind that was never asked, with no share', () => {
		const mia = accuracyByType(db, scopeFor(fixture.mia, 'all', NOW, CHICAGO));
		expect(mia[3]).toEqual({ type: 'spell', firstAttempts: 0, firstCorrect: 0, share: null });
	});
});

describe('responseTimes', () => {
	it('gives the median time, overall and for each kind of question', () => {
		// All twelve, sorted: 0.9 1.0 1.2 2.0 2.5 3.0 | 3.0 4.0 5.0 6.0 7.0 8.0 → 3.0s.
		// Meaning, sorted: 1.0 1.2 2.0 3.0 | 3.0 4.0 5.0 8.0 → 3.0s.
		// Word: 2.5 and 6.0 → 4.25s.
		expect(responseTimes(db, sam('all'))).toEqual({
			overallMs: 3000,
			byType: [
				{ type: 'word_to_def', answers: 8, medianMs: 3000 },
				{ type: 'def_to_word', answers: 2, medianMs: 4250 },
				{ type: 'cloze', answers: 1, medianMs: 7000 },
				{ type: 'spell', answers: 1, medianMs: 900 }
			]
		});
	});

	it('averages the two middle values of an even number of answers', () => {
		// From 9 November there are four: 0.9, 2.5, 3.0, 7.0.
		const scope = { ...sam('all'), since: new Date('2026-11-09T00:00:00Z') };
		expect(responseTimes(db, scope).overallMs).toBe(2750);
	});

	it('takes the middle value of an odd number of answers', () => {
		// From the second question of S3 there are three: 0.9, 3.0, 7.0.
		const scope = { ...sam('all'), since: new Date('2026-11-09T15:00:15Z') };
		expect(responseTimes(db, scope).overallMs).toBe(3000);
	});

	it('has no median without answers', () => {
		const scope = { ...sam('all'), since: new Date('2026-11-10T22:00:00Z') };
		expect(responseTimes(db, scope).overallMs).toBeNull();
	});
});

describe('guessing', () => {
	it('is the share of wrong answers given in under 1.5 seconds', () => {
		// Wrong multiple-choice answers: 1.0s, 1.2s, 8.0s, 2.5s. The 0.9s spelling miss is
		// left out.
		expect(guessing(db, sam('all'))).toEqual({ wrong: 4, fastWrong: 2, share: 0.5 });
	});

	it('treats exactly 1.5 seconds as not a guess', () => {
		db.update(answer).set({ responseMs: 1500 }).where(eq(answer.responseMs, 1200)).run();
		expect(guessing(db, sam('all'))).toEqual({ wrong: 4, fastWrong: 1, share: 0.25 });
	});

	it('has no share when nothing was wrong', () => {
		expect(guessing(db, scopeFor(fixture.mia, 'all', NOW, CHICAGO))).toEqual({
			wrong: 0,
			fastWrong: 0,
			share: null
		});
	});
});

describe('timeOfDay', () => {
	it('groups first attempts by the hour on the local clock', () => {
		// S3 at 9am, S4 at 3:50pm, S2 at 4pm, and S1 at 5pm (22:00 UTC, but still on
		// daylight saving time in October).
		expect(timeOfDay(db, sam('all'))).toEqual({
			hours: [
				{ hour: 9, firstAttempts: 2, firstCorrect: 1, share: 0.5 },
				{ hour: 15, firstAttempts: 2, firstCorrect: 1, share: 0.5 },
				{ hour: 16, firstAttempts: 3, firstCorrect: 2, share: 2 / 3 },
				{ hour: 17, firstAttempts: 3, firstCorrect: 2, share: 2 / 3 }
			],
			// Ten first attempts are far too few to name a best hour.
			best: null
		});
	});

	it('names the best hour once there is enough to compare', () => {
		const result = createChild(db, { name: 'Zed', grade: 3 });
		if (!result.ok) throw new Error();
		const wordId = db.select().from(word).all()[0].id;

		/** `count` first attempts starting at the given UTC hour on 5 November. */
		const answersAt = (utcHour: number, count: number, right: number) => {
			const startedAt = new Date(Date.UTC(2026, 10, 5, utcHour));
			const session = db
				.insert(practiceSession)
				.values({ childId: result.child.id, startedAt, endedAt: startedAt, completed: true })
				.returning()
				.get();
			for (let index = 0; index < count; index++) {
				const asked = db
					.insert(question)
					.values({
						practiceSessionId: session.id,
						wordId,
						type: 'word_to_def',
						choicesJson: [],
						correctChoice: 'x',
						servedAt: startedAt
					})
					.returning()
					.get();
				db.insert(answer)
					.values({
						questionId: asked.id,
						chosen: 'x',
						isCorrect: index < right,
						responseMs: 2000,
						answeredAt: new Date(startedAt.getTime() + index * 1000)
					})
					.run();
			}
		};
		const scope = scopeFor(result.child.id, 'all', NOW, CHICAGO);

		answersAt(14, 30, 27); // 8am: 90%
		answersAt(22, 15, 9); // 4pm: 60%
		// 45 answers in all: not yet enough.
		expect(timeOfDay(db, scope).best).toBeNull();

		answersAt(2, 5, 5); // 8pm the evening before: 100%, but only five answers
		expect(timeOfDay(db, scope).best).toEqual({
			hour: 8,
			firstAttempts: 30,
			firstCorrect: 27,
			share: 0.9
		});
	});
});
