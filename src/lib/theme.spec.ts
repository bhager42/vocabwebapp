import { describe, expect, it } from 'vitest';
import { colorSchemeFor, parseTheme, safeReturnPath } from './theme.ts';

describe('parseTheme', () => {
	it('accepts the three known themes', () => {
		expect(parseTheme('light')).toBe('light');
		expect(parseTheme('dark')).toBe('dark');
		expect(parseTheme('system')).toBe('system');
	});

	it('falls back to system for anything else', () => {
		expect(parseTheme(undefined)).toBe('system');
		expect(parseTheme('')).toBe('system');
		expect(parseTheme('DARK')).toBe('system');
		expect(parseTheme('"><script>')).toBe('system');
	});
});

describe('colorSchemeFor', () => {
	it('offers both schemes only when following the device', () => {
		expect(colorSchemeFor('system')).toBe('light dark');
		expect(colorSchemeFor('light')).toBe('light');
		expect(colorSchemeFor('dark')).toBe('dark');
	});
});

describe('safeReturnPath', () => {
	it('keeps same-site paths, including a query string', () => {
		expect(safeReturnPath('/')).toBe('/');
		expect(safeReturnPath('/parent/words?grade=3')).toBe('/parent/words?grade=3');
	});

	it('rejects anything that could leave the site', () => {
		expect(safeReturnPath('https://evil.example/')).toBe('/');
		expect(safeReturnPath('//evil.example/')).toBe('/');
		expect(safeReturnPath('/\\evil.example/')).toBe('/');
		expect(safeReturnPath('parent')).toBe('/');
		expect(safeReturnPath(undefined)).toBe('/');
		expect(safeReturnPath(null)).toBe('/');
	});
});
