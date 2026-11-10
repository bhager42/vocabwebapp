import { timingSafeEqual } from 'node:crypto';
import type { SessionKind } from './session.ts';

export const LOGIN_PATH = '/parent/login';

/** True for every path that only a signed-in parent may reach. */
export function requiresParent(pathname: string): boolean {
	const path = pathname.replace(/\/+$/, '') || '/';
	if (path === LOGIN_PATH) return false;
	return path === '/parent' || path.startsWith('/parent/');
}

/** True for every path that only a signed-in child may reach. */
export function requiresChild(pathname: string): boolean {
	return pathname === '/play' || pathname.startsWith('/play/');
}

/** Pages whose responses must never be stored by the browser or a proxy. */
export function isPrivatePath(pathname: string): boolean {
	return (
		pathname === '/' || // greets a signed-in child by name
		pathname === '/parent' ||
		pathname.startsWith('/parent/') ||
		pathname.startsWith('/setup') ||
		requiresChild(pathname)
	);
}

/**
 * Cookie settings for a session. Over HTTPS the cookie is marked Secure and uses the
 * `__Host-` prefix, which stops any other site on the same domain from overwriting it.
 * Over plain HTTP (a home network without a reverse proxy) neither is possible.
 */
export function sessionCookie(kind: SessionKind, url: URL) {
	const secure = url.protocol === 'https:';
	return {
		name: secure ? `__Host-vocab_${kind}` : `vocab_${kind}`,
		options: { path: '/', httpOnly: true, sameSite: 'strict', secure } as const
	};
}

/** Compares two secrets without revealing, through timing, how much of a guess was right. */
export function secretsMatch(given: string, expected: string): boolean {
	const a = Buffer.from(given, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	// timingSafeEqual needs equal lengths; compare `b` with itself to spend the same time.
	if (a.length !== b.length) {
		timingSafeEqual(b, b);
		return false;
	}
	return timingSafeEqual(a, b);
}
