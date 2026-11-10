import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Argon2id with the parameters OWASP currently recommends as a minimum:
// 19 MiB of memory, 2 passes, 1 lane. Uses Node's built-in implementation.
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export const PASSWORD_MIN_LENGTH = 12;
/** An upper bound so nobody can make the server hash megabytes of text. */
export const PASSWORD_MAX_LENGTH = 256;

const argon2Async = promisify(argon2);

function derive(password: string, salt: Buffer, memory: number, passes: number, lanes: number) {
	return argon2Async('argon2id', {
		message: Buffer.from(password, 'utf8'),
		nonce: salt,
		memory,
		passes,
		parallelism: lanes,
		tagLength: HASH_BYTES
	});
}

const encode = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

/**
 * Hashes a password. The result is a standard PHC string that records the algorithm
 * and its parameters next to the salt and hash, for example
 * `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`, so the parameters can be raised
 * later without breaking existing passwords.
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES);
	const hash = await derive(password, salt, MEMORY_KIB, PASSES, PARALLELISM);
	return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${encode(salt)}$${encode(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Checks a password against a stored hash. Never throws: anything malformed is "no". */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
	const match = PHC.exec(stored);
	if (!match) return false;

	const [, memory, passes, lanes, salt, hash] = match;
	const expected = Buffer.from(hash, 'base64');
	if (expected.length !== HASH_BYTES) return false;

	try {
		const actual = await derive(
			password,
			Buffer.from(salt, 'base64'),
			Number(memory),
			Number(passes),
			Number(lanes)
		);
		return timingSafeEqual(actual, expected);
	} catch {
		return false;
	}
}

/**
 * A real hash of a random password nobody knows. Logging in with an unknown username
 * is checked against this, so it takes as long as a wrong password for a real account
 * and the response time does not reveal which usernames exist.
 */
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
	decoy ??= hashPassword(randomBytes(32).toString('hex'));
	return decoy;
}
