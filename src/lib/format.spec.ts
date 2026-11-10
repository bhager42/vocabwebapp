import { describe, expect, it } from 'vitest';
import { duration, percent, plural, seconds } from './format.ts';

describe('percent', () => {
	it('rounds to a whole percent', () => {
		expect(percent(0)).toBe('0%');
		expect(percent(2 / 3)).toBe('67%');
		expect(percent(1)).toBe('100%');
	});

	it('shows a dash when there is no value', () => {
		expect(percent(null)).toBe('–');
	});
});

describe('duration', () => {
	it('uses seconds under a minute', () => {
		expect(duration(0)).toBe('0 sec');
		expect(duration(59_400)).toBe('59 sec');
	});

	it('uses minutes under an hour', () => {
		expect(duration(60_000)).toBe('1 min');
		expect(duration(630_000)).toBe('11 min');
		expect(duration(59 * 60_000)).toBe('59 min');
	});

	it('uses hours and minutes after that', () => {
		expect(duration(60 * 60_000)).toBe('1 h');
		expect(duration(65 * 60_000)).toBe('1 h 5 min');
		expect(duration(125 * 60_000 + 20_000)).toBe('2 h 5 min');
	});

	it('never shows 60 of a smaller unit', () => {
		expect(duration(59_600)).toBe('1 min');
		expect(duration(59 * 60_000 + 40_000)).toBe('1 h');
	});
});

describe('seconds', () => {
	it('shows one decimal place', () => {
		expect(seconds(4250)).toBe('4.3 sec');
		expect(seconds(900)).toBe('0.9 sec');
		expect(seconds(null)).toBe('–');
	});
});

describe('plural', () => {
	it('picks the right form', () => {
		expect(plural(1, 'day')).toBe('1 day');
		expect(plural(0, 'day')).toBe('0 days');
		expect(plural(2, 'child', 'children')).toBe('2 children');
	});
});
