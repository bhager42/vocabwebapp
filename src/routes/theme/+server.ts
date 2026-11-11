import { error, redirect } from '@sveltejs/kit';
import { isTheme, safeReturnPath, THEME_COOKIE } from '#lib/theme.ts';
import type { RequestHandler } from './$types';

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Saves the theme choice in a cookie.
 *
 * Posted to by the theme toggle. Without JavaScript it is an ordinary form post and
 * the browser is redirected back to the page it came from. With JavaScript the toggle
 * asks for JSON and gets an empty 204 instead.
 */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const form = await request.formData();
	const theme = form.get('theme');
	if (!isTheme(theme)) error(400, 'Unknown theme');

	// Setting and deleting must use the same flags. In particular `secure` is always
	// given: SvelteKit otherwise marks the cookie Secure on any host but localhost, and
	// on a plain-HTTP home network the browser silently ignores that, so choosing
	// "Match this device" would leave the old light or dark cookie in place.
	const options = {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:'
	} as const;

	if (theme === 'system') cookies.delete(THEME_COOKIE, options);
	else cookies.set(THEME_COOKIE, theme, { ...options, maxAge: ONE_YEAR });

	if (request.headers.get('accept')?.includes('application/json')) {
		return new Response(null, { status: 204 });
	}
	redirect(303, safeReturnPath(form.get('returnTo')));
};
