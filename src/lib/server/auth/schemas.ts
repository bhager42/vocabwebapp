import * as v from 'valibot';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.ts';

export const usernameSchema = v.pipe(
	v.string('Please choose a username.'),
	v.trim(),
	v.toLowerCase(),
	v.regex(
		/^[a-z0-9._-]{3,32}$/,
		'A username is 3 to 32 characters: letters, numbers, dots, dashes or underscores.'
	)
);

// Length is what makes a password strong, so there are no "one symbol, one capital" rules.
export const newPasswordSchema = v.pipe(
	v.string('Please choose a password.'),
	v.minLength(PASSWORD_MIN_LENGTH, `A password needs at least ${PASSWORD_MIN_LENGTH} characters.`),
	v.maxLength(PASSWORD_MAX_LENGTH, `A password can be at most ${PASSWORD_MAX_LENGTH} characters.`)
);

const confirmSchema = v.string('Please type the password again.');

const MISMATCH = 'The two passwords do not match.';

export const setupSchema = v.pipe(
	v.object({ username: usernameSchema, password: newPasswordSchema, confirm: confirmSchema }),
	v.forward(
		v.check((input) => input.password === input.confirm, MISMATCH),
		['confirm']
	),
	v.forward(
		v.check(
			(input) => input.password.toLowerCase() !== input.username,
			'The password must not be the same as the username.'
		),
		['password']
	)
);

export const changePasswordSchema = v.pipe(
	v.object({
		current: v.pipe(
			v.string('Please enter your current password.'),
			v.minLength(1, 'Please enter your current password.'),
			v.maxLength(PASSWORD_MAX_LENGTH, 'That password is too long.')
		),
		password: newPasswordSchema,
		confirm: confirmSchema
	}),
	v.forward(
		v.check((input) => input.password === input.confirm, MISMATCH),
		['confirm']
	)
);

// Sign-in only caps the lengths: saying anything more would describe the real account.
export const loginSchema = v.object({
	username: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(64)),
	password: v.pipe(v.string(), v.maxLength(PASSWORD_MAX_LENGTH))
});
