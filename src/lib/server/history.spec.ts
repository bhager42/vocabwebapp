import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/client.ts';
import { answer, practiceSession, question, wordProgress } from './db/schema.ts';
import {
	answersCsv,
	csvCell,
	deleteSession,
	sessionDetail,
	sessionLog,
	SESSIONS_PER_PAGE,
	stageOf,
	wordHistory,
	wordTable
} from './history.ts';
import { accuracy, scopeFor } from './metrics.ts';
import { createTestDb } from './test-db.ts';
import { buildFixture, CHICAGO, NOW, type Fixture } from './test-fixture.ts';

// See test-fixture.ts for the practice history used here.

let db: Db;
let close: () => void;
let fixture: Fixture;

beforeEach(() => {
	({ db, close } = createTestDb());
	fixture = buildFixture(db);
});
afterEach(() => close());

const count = (table: typeof answer | typeof question | typeof practiceSession) =>
	db.select().from(table).all().length;

describe('sessionLog', () => {
	it('lists the sessions newest first, with their results', () => {
		const [s1, s2, s3, s4] = fixture.sessions;
		const log = sessionLog(db, fixture.sam, NOW);
		expect(log.pages).toBe(1);
		expect(log.sessions).toEqual([
			{
				id: s4,
				startedAt: new Date('2026-11-10T21:50:00Z'),
				activeMs: 30_000,
				status: 'in-progress',
				answered: 2,
				correct: 1
			},
			{
				id: s3,
				startedAt: new Date('2026-11-09T15:00:00Z'),
				activeMs: 60_000,
				status: 'stopped',
				answered: 2,
				correct: 1
			},
			{
				id: s2,
				startedAt: new Date('2026-11-04T22:00:00Z'),
				activeMs: 240_000,
				status: 'finished',
				answered: 4,
				correct: 2
			},
			{
				id: s1,
				startedAt: new Date('2026-10-20T22:00:00Z'),
				activeMs: 300_000,
				status: 'finished',
				answered: 4,
				correct: 3
			}
		]);
	});

	it('shows an open session as stopped once it is too old to resume', () => {
		const log = sessionLog(db, fixture.sam, new Date('2026-11-10T23:00:00Z'));
		expect(log.sessions[0].status).toBe('stopped');
	});

	it('is split into pages', () => {
		for (let index = 0; index < SESSIONS_PER_PAGE; index++) {
			db.insert(practiceSession)
				.values({ childId: fixture.sam, startedAt: new Date(Date.UTC(2026, 8, 1 + index)) })
				.run();
		}
		const first = sessionLog(db, fixture.sam, NOW, 1);
		const second = sessionLog(db, fixture.sam, NOW, 2);
		expect(first.pages).toBe(2);
		expect(first.sessions).toHaveLength(SESSIONS_PER_PAGE);
		expect(second.sessions).toHaveLength(4);
		// A session with no questions has nothing answered, not an error.
		expect(second.sessions.at(-1)).toMatchObject({ answered: 0, correct: 0 });
		expect(sessionLog(db, fixture.sam, NOW, 9).sessions).toEqual([]);
	});
});

describe('sessionDetail', () => {
	it('lists every question in the order it was asked', () => {
		const detail = sessionDetail(db, fixture.sam, fixture.sessions[1], NOW)!;
		expect(detail).toMatchObject({ status: 'finished', answered: 4, correct: 2 });
		expect(
			detail.questions.map((entry) => [
				entry.word,
				entry.type,
				entry.isCorrect,
				entry.chosen,
				entry.isRetry
			])
		).toEqual([
			['w1', 'def_to_word', true, 'w1', false],
			['w2', 'word_to_def', false, 'meaning of w3', false],
			['w4', 'word_to_def', true, 'meaning of w4', false],
			['w2', 'word_to_def', false, 'meaning of w5', true]
		]);
		expect(detail.questions[1]).toMatchObject({
			correctChoice: 'meaning of w2',
			responseMs: 1200
		});
	});

	it('shows a question that was served but never answered', () => {
		db.insert(question)
			.values({
				practiceSessionId: fixture.sessions[3],
				wordId: fixture.words.w6,
				type: 'word_to_def',
				choicesJson: ['a', 'b'],
				correctChoice: 'a',
				servedAt: NOW
			})
			.run();
		const detail = sessionDetail(db, fixture.sam, fixture.sessions[3], NOW)!;
		expect(detail.answered).toBe(2);
		expect(detail.questions.at(-1)).toMatchObject({
			word: 'w6',
			chosen: null,
			isCorrect: null,
			responseMs: null,
			isRetry: false
		});
	});

	it("does not show one child's session under another child", () => {
		expect(sessionDetail(db, fixture.mia, fixture.sessions[0], NOW)).toBeNull();
		expect(sessionDetail(db, fixture.sam, 99_999, NOW)).toBeNull();
	});
});

describe('deleteSession', () => {
	it('removes the session with its questions and answers', () => {
		expect(deleteSession(db, fixture.sam, fixture.sessions[1])).toBe(true);
		expect(count(practiceSession)).toBe(4);
		expect(count(question)).toBe(9);
		expect(count(answer)).toBe(9);
		// S2 had 2 of 3 first attempts right: 6 of 10 becomes 4 of 7.
		expect(accuracy(db, scopeFor(fixture.sam, 'all', NOW, CHICAGO))).toMatchObject({
			firstAttempts: 7,
			firstCorrect: 4
		});
	});

	it('leaves the boxes of the words alone', () => {
		const before = db.select().from(wordProgress).all();
		deleteSession(db, fixture.sam, fixture.sessions[1]);
		expect(db.select().from(wordProgress).all()).toEqual(before);
	});

	it("refuses another child's session", () => {
		expect(deleteSession(db, fixture.mia, fixture.sessions[1])).toBe(false);
		expect(deleteSession(db, fixture.sam, 99_999)).toBe(false);
		expect(count(practiceSession)).toBe(5);
		expect(count(answer)).toBe(13);
	});
});

describe('wordTable', () => {
	it('lists the words a child has met, least settled first and mastered last', () => {
		expect(
			wordTable(db, fixture.sam).map((entry) => [
				entry.word,
				entry.box,
				entry.stage,
				entry.timesCorrect,
				entry.timesSeen
			])
		).toEqual([
			['w2', 1, 'learning', 1, 4],
			['w5', 1, 'learning', 0, 1],
			['w1', 3, 'learning', 3, 3],
			['w3', 4, 'almost', 1, 2],
			['w4', 5, 'mastered', 2, 2]
		]);
	});

	it("is each child's own", () => {
		expect(wordTable(db, fixture.mia).map((entry) => entry.word)).toEqual(['w1']);
	});

	it('names the stages', () => {
		expect([stageOf(1, false), stageOf(3, false)]).toEqual(['learning', 'learning']);
		expect([stageOf(4, false), stageOf(5, false)]).toEqual(['almost', 'almost']);
		expect(stageOf(5, true)).toBe('mastered');
	});
});

describe('wordHistory', () => {
	it('gives the word, where it stands, and every answer, newest first', () => {
		const [s1, s2] = fixture.sessions;
		const history = wordHistory(db, fixture.sam, fixture.words.w2)!;
		expect(history).toMatchObject({
			word: 'w2',
			grade: 3,
			definition: 'meaning of w2',
			progress: { box: 1, stage: 'learning', timesSeen: 4, timesCorrect: 1 }
		});
		expect(
			history.answers.map((entry) => [
				entry.sessionId,
				entry.isCorrect,
				entry.chosen,
				entry.isRetry
			])
		).toEqual([
			[s2, false, 'meaning of w5', true],
			[s2, false, 'meaning of w3', false],
			[s1, true, 'meaning of w2', true],
			[s1, false, 'meaning of w3', false]
		]);
	});

	it("leaves out another child's answers for the same word", () => {
		// Sam and Mia have both been asked w1.
		expect(wordHistory(db, fixture.mia, fixture.words.w1)!.answers).toHaveLength(1);
		expect(wordHistory(db, fixture.sam, fixture.words.w1)!.answers).toHaveLength(3);
	});

	it('has no progress for a word not asked yet, and is null for no such word', () => {
		expect(wordHistory(db, fixture.sam, fixture.words.w9)).toMatchObject({
			word: 'w9',
			progress: null,
			answers: []
		});
		expect(wordHistory(db, fixture.sam, 99_999)).toBeNull();
	});
});

describe('csvCell', () => {
	it('leaves plain text and numbers alone', () => {
		expect(csvCell('enormous')).toBe('enormous');
		expect(csvCell(42)).toBe('42');
		expect(csvCell(-3)).toBe('-3');
	});

	it('quotes commas, quotes and line breaks', () => {
		expect(csvCell('very, very big')).toBe('"very, very big"');
		expect(csvCell('say "hi"')).toBe('"say ""hi"""');
		expect(csvCell('two\nlines')).toBe('"two\nlines"');
	});

	it('defuses text a spreadsheet would run as a formula', () => {
		expect(csvCell('=1+1')).toBe("'=1+1");
		expect(csvCell('+1')).toBe("'+1");
		expect(csvCell('-1')).toBe("'-1");
		expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
		expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
	});
});

describe('answersCsv', () => {
	it('has a header and one line per answer, oldest first', () => {
		const lines = answersCsv(db, fixture.sam, CHICAGO).split('\r\n');
		expect(lines).toHaveLength(14); // header, 12 answers, and the empty end
		expect(lines[0]).toBe(
			'answered_at_utc,local_date,session,word,grade,question_type,correct,answer_given,right_answer,seconds,asked_again_in_session'
		);
		expect(lines[1]).toBe(
			`2026-10-20T22:00:10.000Z,2026-10-20,${fixture.sessions[0]},w1,3,word_to_def,yes,meaning of w1,meaning of w1,4.0,no`
		);
		expect(lines[4]).toBe(
			`2026-10-20T22:00:40.000Z,2026-10-20,${fixture.sessions[0]},w2,3,word_to_def,yes,meaning of w2,meaning of w2,3.0,yes`
		);
		expect(lines.at(-1)).toBe('');
	});

	it('uses the local date, which can differ from the UTC one', () => {
		db.update(answer)
			.set({ answeredAt: new Date('2026-11-10T03:00:00Z') })
			.where(eq(answer.responseMs, 900))
			.run();
		expect(answersCsv(db, fixture.sam, CHICAGO)).toContain('2026-11-10T03:00:00.000Z,2026-11-09,');
	});

	it('defuses a formula typed as a spelling answer', () => {
		db.update(answer).set({ chosen: '=cmd|x' }).where(eq(answer.chosen, 'gw5')).run();
		expect(answersCsv(db, fixture.sam, CHICAGO)).toContain(",no,'=cmd|x,w5,");
	});

	it("holds only the child's own answers", () => {
		expect(answersCsv(db, fixture.mia, CHICAGO).split('\r\n')).toHaveLength(3);
	});
});
