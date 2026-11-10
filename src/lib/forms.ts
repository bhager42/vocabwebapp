import type { SubmitFunction } from '$app/forms';

/**
 * For `use:enhance` on forms with password fields: when the server rejects the form,
 * empty the password boxes, as a full page reload would. Other fields keep their values.
 */
export const clearPasswordsOnFailure: SubmitFunction = () => {
	return async ({ result, update, formElement }) => {
		await update({ reset: result.type !== 'failure' });
		if (result.type === 'failure') {
			for (const input of formElement.querySelectorAll<HTMLInputElement>(
				'input[type="password"]'
			)) {
				input.value = '';
			}
		}
	};
};
