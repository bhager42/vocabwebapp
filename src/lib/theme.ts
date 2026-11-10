export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'theme';

export function isTheme(value: unknown): value is Theme {
	return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Anything unrecognized (including no cookie at all) means "follow the device". */
export function parseTheme(value: unknown): Theme {
	return isTheme(value) ? value : 'system';
}

/** Value for `<meta name="color-scheme">`, which the browser reads before any CSS loads. */
export function colorSchemeFor(theme: Theme): string {
	return theme === 'system' ? 'light dark' : theme;
}

/**
 * Where to send the browser after a form post. Only same-site paths are allowed,
 * so the field can never be used to redirect someone to another website.
 */
export function safeReturnPath(value: unknown): string {
	if (typeof value !== 'string') return '/';
	if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
	return value;
}
