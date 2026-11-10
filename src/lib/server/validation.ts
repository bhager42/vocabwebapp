import * as v from 'valibot';

export type FieldErrors = Record<string, string>;

export type Parsed<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/**
 * Validates submitted form data against a schema. On failure returns one message per
 * field (the first problem found), ready to show next to that field.
 */
export function parseForm<TSchema extends v.GenericSchema>(
	schema: TSchema,
	form: FormData
): Parsed<v.InferOutput<TSchema>> {
	// Only text fields are expected; a file upload is treated as missing.
	const input: Record<string, string> = {};
	for (const [key, value] of form) {
		if (typeof value === 'string') input[key] = value;
	}

	const result = v.safeParse(schema, input);
	if (result.success) return { ok: true, data: result.output };

	const errors: FieldErrors = {};
	for (const issue of result.issues) {
		const field = String(issue.path?.[0]?.key ?? 'form');
		errors[field] ??= issue.message;
	}
	return { ok: false, errors };
}

/** A checkbox: present in the form data when ticked, absent when not. */
export const checkbox = v.pipe(
	// The empty-string default matters: without one, a missing key is left out of the
	// result altogether instead of becoming `false`.
	v.optional(v.string(), ''),
	v.transform((value) => value !== '')
);

/** A whole number typed into a form field, within a range. */
export const wholeNumber = (label: string, min: number, max: number) =>
	v.pipe(
		v.string(`${label} is required.`),
		v.trim(),
		v.regex(/^\d+$/, `${label} must be a whole number.`),
		v.transform(Number),
		v.minValue(min, `${label} must be at least ${min}.`),
		v.maxValue(max, `${label} must be at most ${max}.`)
	);
