import { describe, expect, it } from 'vitest';
import {
	currentStreak,
	dayKeysBetween,
	formatDateTime,
	formatDay,
	formatHour,
	formatShortDay,
	localDayKey,
	localHour,
	longestStreak,
	shiftDayKey,
	startOfLocalDay
} from './time.ts';

const CHICAGO = 'America/Chicago';

describe('localDayKey', () => {
	it('gives the calendar date in the zone, not in UTC', () => {
		// 03:30 UTC on the 10th is still the evening of the 9th in Chicago.
		const instant = new Date('2026-11-10T03:30:00Z');

		expect(localDayKey(instant, 'UTC')).toBe('2026-11-10');
		expect(localDayKey(instant, CHICAGO)).toBe('2026-11-09');
		expect(localDayKey(instant, 'Asia/Tokyo')).toBe('2026-11-10');
	});

	it('changes exactly at local midnight', () => {
		expect(localDayKey(new Date('2026-11-10T05:59:59Z'), CHICAGO)).toBe('2026-11-09');
		expect(localDayKey(new Date('2026-11-10T06:00:00Z'), CHICAGO)).toBe('2026-11-10');
	});
});

describe('startOfLocalDay', () => {
	it('finds local midnight today', () => {
		// Chicago is UTC-6 in November, so its midnight is 06:00 UTC.
		expect(startOfLocalDay(new Date('2026-11-10T18:00:00Z'), CHICAGO)).toEqual(
			new Date('2026-11-10T06:00:00Z')
		);
		expect(startOfLocalDay(new Date('2026-11-10T18:00:00Z'), 'UTC')).toEqual(
			new Date('2026-11-10T00:00:00Z')
		);
	});

	it('finds local midnight a number of days ahead', () => {
		expect(startOfLocalDay(new Date('2026-11-10T18:00:00Z'), CHICAGO, 1)).toEqual(
			new Date('2026-11-11T06:00:00Z')
		);
		expect(startOfLocalDay(new Date('2026-11-10T18:00:00Z'), CHICAGO, 21)).toEqual(
			new Date('2026-12-01T06:00:00Z')
		);
	});

	it('uses the local day even when UTC has already moved on to the next one', () => {
		// 9pm on the 9th in Chicago is 03:00 UTC on the 10th. "Tomorrow" is the 10th.
		expect(startOfLocalDay(new Date('2026-11-10T03:00:00Z'), CHICAGO, 1)).toEqual(
			new Date('2026-11-10T06:00:00Z')
		);
	});

	it('gives the same "tomorrow" one minute before and well before midnight', () => {
		const morning = new Date('2026-11-09T14:00:00Z'); // 8am
		const lastMinute = new Date('2026-11-10T05:59:00Z'); // 11:59pm

		expect(startOfLocalDay(lastMinute, CHICAGO, 1)).toEqual(startOfLocalDay(morning, CHICAGO, 1));
		// ...and one minute after midnight, tomorrow is a day later.
		expect(startOfLocalDay(new Date('2026-11-10T06:01:00Z'), CHICAGO, 1)).toEqual(
			new Date('2026-11-11T06:00:00Z')
		);
	});

	it('stays on local midnight when the clocks go back', () => {
		// US clocks go back on 1 November 2026: UTC-5 before, UTC-6 after.
		const halloween = new Date('2026-10-31T20:00:00Z');

		expect(startOfLocalDay(halloween, CHICAGO)).toEqual(new Date('2026-10-31T05:00:00Z'));
		expect(startOfLocalDay(halloween, CHICAGO, 1)).toEqual(new Date('2026-11-01T05:00:00Z'));
		expect(startOfLocalDay(halloween, CHICAGO, 2)).toEqual(new Date('2026-11-02T06:00:00Z'));
	});

	it('stays on local midnight when the clocks go forward', () => {
		// US clocks go forward on 8 March 2026: UTC-6 before, UTC-5 after.
		const before = new Date('2026-03-07T20:00:00Z');

		expect(startOfLocalDay(before, CHICAGO, 1)).toEqual(new Date('2026-03-08T06:00:00Z'));
		expect(startOfLocalDay(before, CHICAGO, 2)).toEqual(new Date('2026-03-09T05:00:00Z'));
	});

	it('crosses month and year ends', () => {
		expect(startOfLocalDay(new Date('2026-12-31T12:00:00Z'), 'UTC', 1)).toEqual(
			new Date('2027-01-01T00:00:00Z')
		);
		expect(startOfLocalDay(new Date('2028-02-28T12:00:00Z'), 'UTC', 1)).toEqual(
			new Date('2028-02-29T00:00:00Z')
		);
	});

	it('handles zones ahead of UTC and with half-hour offsets', () => {
		expect(startOfLocalDay(new Date('2026-11-10T12:00:00Z'), 'Asia/Tokyo')).toEqual(
			new Date('2026-11-09T15:00:00Z')
		);
		expect(startOfLocalDay(new Date('2026-11-10T12:00:00Z'), 'Asia/Kolkata')).toEqual(
			new Date('2026-11-09T18:30:00Z')
		);
	});
});

describe('shiftDayKey', () => {
	it('moves across month and year ends', () => {
		expect(shiftDayKey('2026-11-10', -1)).toBe('2026-11-09');
		expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
		expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
	});
});

describe('currentStreak', () => {
	const days = (...keys: string[]) => new Set(keys);

	it('is zero with no practice', () => {
		expect(currentStreak(days(), '2026-11-10')).toBe(0);
	});

	it('counts back from today', () => {
		expect(currentStreak(days('2026-11-10'), '2026-11-10')).toBe(1);
		expect(currentStreak(days('2026-11-08', '2026-11-09', '2026-11-10'), '2026-11-10')).toBe(3);
	});

	it('is not broken by today until today is over', () => {
		expect(currentStreak(days('2026-11-08', '2026-11-09'), '2026-11-10')).toBe(2);
	});

	it('is broken by a missed day', () => {
		expect(currentStreak(days('2026-11-07', '2026-11-08'), '2026-11-10')).toBe(0);
		expect(
			currentStreak(days('2026-11-06', '2026-11-07', '2026-11-09', '2026-11-10'), '2026-11-10')
		).toBe(2);
	});

	it('runs across a month end', () => {
		expect(currentStreak(days('2026-10-30', '2026-10-31', '2026-11-01'), '2026-11-01')).toBe(3);
	});
});

describe('longestStreak', () => {
	const days = (...keys: string[]) => new Set(keys);

	it('is zero with no practice and one for a single day', () => {
		expect(longestStreak(days())).toBe(0);
		expect(longestStreak(days('2026-11-10'))).toBe(1);
	});

	it('finds the longest run, wherever it is', () => {
		expect(
			longestStreak(
				days('2026-10-30', '2026-10-31', '2026-11-01', '2026-11-03', '2026-11-09', '2026-11-10')
			)
		).toBe(3);
	});

	it('does not join runs across a gap', () => {
		expect(longestStreak(days('2026-11-01', '2026-11-03', '2026-11-05'))).toBe(1);
	});
});

describe('dayKeysBetween', () => {
	it('lists every day, both ends included', () => {
		expect(dayKeysBetween('2026-10-30', '2026-11-02')).toEqual([
			'2026-10-30',
			'2026-10-31',
			'2026-11-01',
			'2026-11-02'
		]);
		expect(dayKeysBetween('2026-11-10', '2026-11-10')).toEqual(['2026-11-10']);
	});

	it('is empty when the end is before the start', () => {
		expect(dayKeysBetween('2026-11-10', '2026-11-09')).toEqual([]);
	});
});

describe('localHour', () => {
	it("is the hour on the zone's clock", () => {
		expect(localHour(new Date('2026-11-10T22:30:00Z'), 'America/Chicago')).toBe(16);
		// Daylight saving time: one hour later on the clock for the same UTC time.
		expect(localHour(new Date('2026-07-10T22:30:00Z'), 'America/Chicago')).toBe(17);
		expect(localHour(new Date('2026-11-10T06:00:00Z'), 'America/Chicago')).toBe(0);
		expect(localHour(new Date('2026-11-10T22:30:00Z'), 'UTC')).toBe(22);
	});
});

describe('text for people', () => {
	it('formats a day key without shifting it by a time zone', () => {
		expect(formatDay('2026-11-10')).toBe('Tue, Nov 10');
		expect(formatShortDay('2026-11-01')).toBe('Nov 1');
	});

	it("formats an instant on the zone's clock", () => {
		const text = formatDateTime(new Date('2026-11-10T22:05:00Z'), 'America/Chicago');
		// Some versions put a narrow space before PM; any white space will do.
		expect(text.replace(/\s/g, ' ')).toBe('Nov 10, 2026, 4:05 PM');
	});

	it('formats hours on a 12-hour clock', () => {
		expect([0, 9, 12, 16, 23].map(formatHour)).toEqual(['12 AM', '9 AM', '12 PM', '4 PM', '11 PM']);
	});
});
