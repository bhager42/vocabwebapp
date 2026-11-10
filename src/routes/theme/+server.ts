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

	if (theme === 'system') {
		cookies.delete(THEME_COOKIE, { path: '/' });
	} else {
		cookies.set(THEME_COOKIE, theme, {
			path: '/',
			maxAge: ONE_YEAR,
			httpOnly: true,
			sameSite: 'lax',
			// The app may be served over plain HTTP on a home network, where a Secure
			// cookie would be silently dropped by the browser.
			secure: url.protocol === 'https:'
		});
	}

	if (request.headers.get('accept')?.includes('application/json')) {
		return new Response(null, { status: 204 });
	}
	redirect(303, safeReturnPath(form.get('returnTo')));
};
