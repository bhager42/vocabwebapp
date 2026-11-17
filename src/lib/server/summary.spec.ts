import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChild, setArchived, updateChild, DEFAULT_SETTINGS } from './children.ts';
import type { Db } from './db/client.ts';
import { placementQuiz, wordProgress } from './db/schema.ts';
import {
	childLines,
	childNotes,
	escapeHtml,
	lastWeek,
	renderHtml,
	renderText,
	subject,
	weekday,
	weeklySummary
} from './summary.ts';
import { createTestDb } from './test-db.ts';
import { buildFixture, CHICAGO, type Fixture } from './test-fixture.ts';

// A week after the fixture's "now": Tuesday 17 November 2026, 4pm in Chicago. Last week
// is then Monday 9 to Sunday 15 November, which holds Sam's sessions S3 and S4 and Mia's
// one session. The week before it (2 to 8 November) holds S2.
const NOW = new Date('2026-11-17T22:00:00Z');

let db: Db;
let close: () => void;
let fixture: Fixture;

beforeEach(() => {
	({ db, close } = createTestDb());
	fixture = buildFixture(db);
});

afterEach(() => close());

describe('lastWeek', () => {
	it('is the Monday-to-Sunday week before this one, in local days', () => {
		const week = lastWeek(NOW, CHICAGO);
		expect(week.firstDay).toBe('2026-11-09');
		expect(week.lastDay).toBe('2026-11-15');
		// Chicago is UTC-6 in November.
		expect(week.since.toISOString()).toBe('2026-11-09T06:00:00.000Z');
		expect(week.until.toISOString()).toBe('2026-11-16T06:00:00.000Z');
	});

	it('goes by the local day, not the UTC one', () => {
		// 11pm Sunday in Chicago is already Monday in UTC.
		expect(lastWeek(new Date('2026-11-16T05:00:00Z'), CHICAGO).firstDay).toBe('2026-11-02');
		expect(lastWeek(new Date('2026-11-16T06:00:00Z'), CHICAGO).firstDay).toBe('2026-11-09');
	});

	it('handles a week that crosses a clock change', () => {
		// Chicago left daylight saving time on Sunday 1 November.
		const week = lastWeek(new Date('2026-11-03T18:00:00Z'), CHICAGO);
		expect(week.firstDay).toBe('2026-10-26');
		expect(week.since.toISOString()).toBe('2026-10-26T05:00:00.000Z');
		expect(week.until.toISOString()).toBe('2026-11-02T06:00:00.000Z');
	});

	it('numbers weekdays from Monday', () => {
		expect(weekday('2026-11-16')).toBe(0);
		expect(weekday('2026-11-22')).toBe(6);
	});
});

describe('weeklySummary', () => {
	it('matches the hand-worked figures', () => {
		const summary = weeklySummary(db, NOW, CHICAGO);
		const sam = summary.children.find((child) => child.name === 'Sam')!;
		expect(sam).toEqual({
			name: 'Sam',
			grade: 3,
			// S3 was stopped early and S4 was never finished, so no finished-session days.
			daysPracticed: 0,
			minutes: 2, // 60 s + 30 s, rounded
			sessionsCompleted: 0,
			newWords: 0,
			mastered: 1, // w4, on 9 November
			firstAttempts: 4,
			accuracy: 0.5, // w3 ✗, w4 ✓, w5 ✗, w1 ✓
			previousAccuracy: 2 / 3, // S2 without its retry
			troubleWords: ['w3', 'w5'],
			gradeProgress: 0.2, // w3 and w4 of ten
			readyFor: null,
			quizGrade: null
		});

		const mia = summary.children.find((child) => child.name === 'Mia')!;
		expect(mia).toMatchObject({
			daysPracticed: 1,
			minutes: 2,
			sessionsCompleted: 1,
			accuracy: 1,
			previousAccuracy: null,
			troubleWords: []
		});
	});

	it('leaves out archived children', () => {
		setArchived(db, fixture.mia, true);
		expect(weeklySummary(db, NOW, CHICAGO).children.map((child) => child.name)).toEqual(['Sam']);
	});

	it('says when a child is ready for the next grade, unless moving up is automatic', () => {
		const words = Object.entries(fixture.words).filter(([name]) => /^w\d+$/.test(name));
		for (const [, wordId] of words) {
			db.insert(wordProgress)
				.values({
					childId: fixture.mia,
					wordId,
					box: 4,
					dueAt: NOW,
					firstSeenAt: NOW
				})
				.onConflictDoUpdate({
					target: [wordProgress.childId, wordProgress.wordId],
					set: { box: 4 }
				})
				.run();
		}
		const mia = () =>
			weeklySummary(db, NOW, CHICAGO).children.find((child) => child.name === 'Mia')!;
		expect(mia().readyFor).toBe(4);
		expect(childNotes(mia())).toContain(
			'Ready to move up to grade 4. You can do this on the Progress page.'
		);

		updateChild(db, fixture.mia, {
			name: 'Mia',
			grade: 3,
			...DEFAULT_SETTINGS,
			autoUnlockNextGrade: true
		});
		expect(mia().readyFor).toBeNull();
	});

	it('mentions a placement quiz finished that week', () => {
		db.insert(placementQuiz)
			.values({
				childId: fixture.sam,
				startedAt: new Date('2026-11-11T20:00:00Z'),
				endedAt: new Date('2026-11-11T20:05:00Z'),
				startGrade: 3,
				resultGrade: 5,
				completed: true
			})
			.run();
		const sam = weeklySummary(db, NOW, CHICAGO).children.find((child) => child.name === 'Sam')!;
		expect(sam.quizGrade).toBe(5);
		expect(childNotes(sam)).toContain('A placement quiz this week suggested grade 5.');
	});

	it('gives a child who did not practice one line', () => {
		const result = createChild(db, { name: 'Noor', grade: 3 }, NOW);
		if (!result.ok) throw new Error('setup');
		const noor = weeklySummary(db, NOW, CHICAGO).children.find((child) => child.name === 'Noor')!;
		expect(childLines(noor)).toEqual([]);
		expect(childNotes(noor)[0]).toBe('Noor did not practice this week.');
	});
});

describe('rendering', () => {
	it('writes a plain text email with a link to the dashboard', () => {
		const text = renderText(weeklySummary(db, NOW, CHICAGO), 'https://vocab.home.example');
		expect(text).toContain('Vocab: Mon, Nov 9 to Sun, Nov 15');
		expect(text).toContain('Accuracy: 50% (the week before: 67%)');
		expect(text).toContain('Most missed: w3, w5');
		expect(text).toContain('See more: https://vocab.home.example/parent');
	});

	it('names the week in the subject', () => {
		expect(subject(weeklySummary(db, NOW, CHICAGO))).toBe('Vocab: the week of Nov 9');
	});

	it('escapes every value in the HTML', () => {
		const result = createChild(db, { name: "D'Arcy", grade: 3 }, NOW);
		if (!result.ok) throw new Error('setup');
		const html = renderHtml(weeklySummary(db, NOW, CHICAGO), 'https://x.example/"><script>');
		expect(html).toContain('D&#39;Arcy');
		expect(html).not.toContain("D'Arcy");
		expect(html).not.toContain('<script');
		expect(html).not.toMatch(/<img|src=/);
	});

	it('escapes the five HTML characters', () => {
		expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
		);
	});
});
