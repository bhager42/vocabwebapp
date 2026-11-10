import { describe, expect, it } from 'vitest';
import { applyAnswer, type WordState } from './srs.ts';

const CHICAGO = 'America/Chicago';
// 4pm on Tuesday 10 November 2026 in Chicago.
const now = new Date('2026-11-10T22:00:00Z');
/** Local midnight `days` after 10 November in Chicago. */
const midnight = (days: number) => new Date(Date.UTC(2026, 10, 10 + days, 6));

const due = (box: number, mastered = false): WordState => ({
	box,
	dueAt: new Date('2026-11-10T06:00:00Z'),
	mastered
});
const notDue = (box: number): WordState => ({ box, dueAt: midnight(3), mastered: false });

const right = { correct: true, firstAskInSession: true, now, timeZone: CHICAGO };
const wrong = { ...right, correct: false };

describe('a new word', () => {
	it('goes to box 2, due tomorrow, when the first answer is right', () => {
		expect(applyAnswer(null, right)).toEqual({
			box: 2,
			dueAt: midnight(1),
			mastered: false,
			change: 'introduced'
		});
	});

	it('goes to box 1, due tomorrow, when the first answer is wrong', () => {
		expect(applyAnswer(null, wrong)).toEqual({
			box: 1,
			dueAt: midnight(1),
			mastered: false,
			change: 'introduced'
		});
	});
});

describe('a correct answer to a word that is due', () => {
	it.each([
		[1, 2, 1],
		[2, 3, 3],
		[3, 4, 7],
		[4, 5, 21]
	])('moves box %i to box %i, due in %i day(s)', (from, to, days) => {
		expect(applyAnswer(due(from), right)).toEqual({
			box: to,
			dueAt: midnight(days),
			mastered: false,
			change: 'promoted'
		});
	});

	it('masters the word out of box 5, and brings it back in 60 days', () => {
		expect(applyAnswer(due(5), right)).toEqual({
			box: 5,
			dueAt: new Date('2027-01-09T06:00:00Z'),
			mastered: true,
			change: 'mastered'
		});
	});

	it('keeps a mastered word mastered', () => {
		expect(applyAnswer(due(5, true), right)).toMatchObject({
			box: 5,
			mastered: true,
			change: 'unchanged'
		});
	});

	it('counts a word that became due at this very moment', () => {
		const state = { box: 2, dueAt: now, mastered: false };
		expect(applyAnswer(state, right)).toMatchObject({ box: 3, change: 'promoted' });
	});
});

describe('a wrong answer', () => {
	it.each([2, 3, 4, 5])('sends box %i back to box 1, due tomorrow', (box) => {
		expect(applyAnswer(due(box), wrong)).toEqual({
			box: 1,
			dueAt: midnight(1),
			mastered: false,
			change: 'demoted'
		});
	});

	it('keeps a box 1 word in box 1, due tomorrow', () => {
		expect(applyAnswer(due(1), wrong)).toEqual({
			box: 1,
			dueAt: midnight(1),
			mastered: false,
			change: 'unchanged'
		});
	});

	it('takes away mastery', () => {
		expect(applyAnswer(due(5, true), wrong)).toMatchObject({ box: 1, mastered: false });
	});

	it('counts even when the word was not due or was already asked this session', () => {
		expect(applyAnswer(notDue(4), wrong)).toMatchObject({ box: 1, change: 'demoted' });
		expect(applyAnswer(due(3), { ...wrong, firstAskInSession: false })).toMatchObject({
			box: 1,
			change: 'demoted'
		});
	});
});

describe('a correct answer that is only extra practice', () => {
	it('changes nothing when the word is not due yet', () => {
		const state = notDue(3);
		expect(applyAnswer(state, right)).toEqual({ ...state, change: 'unchanged' });
	});

	it('changes nothing the second time a word is asked in one session', () => {
		const state = due(3);
		expect(applyAnswer(state, { ...right, firstAskInSession: false })).toEqual({
			...state,
			change: 'unchanged'
		});
	});
});

describe('due dates fall on local midnight', () => {
	it('makes a word answered late in the evening due first thing next morning', () => {
		// 11:30pm on Monday the 9th in Chicago, which is already the 10th in UTC.
		const lateEvening = new Date('2026-11-10T05:30:00Z');

		expect(applyAnswer(null, { ...right, now: lateEvening }).dueAt).toEqual(
			new Date('2026-11-10T06:00:00Z')
		);
	});

	it('makes a word answered just after midnight due a whole day later', () => {
		const justAfter = new Date('2026-11-10T06:01:00Z');

		expect(applyAnswer(null, { ...right, now: justAfter }).dueAt).toEqual(
			new Date('2026-11-11T06:00:00Z')
		);
	});

	it('depends on the time zone, not on the server clock', () => {
		const instant = new Date('2026-11-10T05:30:00Z');

		expect(applyAnswer(null, { ...right, now: instant, timeZone: 'UTC' }).dueAt).toEqual(
			new Date('2026-11-11T00:00:00Z')
		);
		expect(applyAnswer(null, { ...right, now: instant, timeZone: 'Asia/Tokyo' }).dueAt).toEqual(
			new Date('2026-11-10T15:00:00Z')
		);
	});

	it('lands on local midnight across a clock change', () => {
		// Friday 30 October, before US clocks go back on 1 November. Three days later is 2 November.
		const beforeChange = new Date('2026-10-30T20:00:00Z');

		const state = { box: 2, dueAt: new Date('2026-10-30T05:00:00Z'), mastered: false };

		expect(applyAnswer(state, { ...right, now: beforeChange }).dueAt).toEqual(
			new Date('2026-11-02T06:00:00Z')
		);
	});
});
