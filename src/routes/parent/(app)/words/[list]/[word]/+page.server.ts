import { error, fail, redirect } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { PARTS_OF_SPEECH } from '#lib/server/content/validate.ts';
import { getDb } from '#lib/server/db/index.ts';
import { idParam } from '#lib/server/params.ts';
import {
	deleteWord,
	getWord,
	getWordList,
	updateWord,
	wordHasBeenAsked,
	type WordInput
} from '#lib/server/words.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	requireParent(locals);
	const db = getDb();
	const list = getWordList(db, idParam(params.list));
	// Only the parent's own words can be changed.
	if (!list || list.source !== 'custom') error(404, 'Word not found');
	const entry = getWord(db, list.id, idParam(params.word));
	if (!entry) error(404, 'Word not found');

	return {
		list: { id: list.id, name: list.name },
		entry: { ...entry, synonyms: entry.synonyms.join(', ') },
		practiced: wordHasBeenAsked(db, entry.id),
		partsOfSpeech: [...PARTS_OF_SPEECH]
	};
};

export const actions: Actions = {
	save: async ({ locals, params, request }) => {
		requireParent(locals);
		const form = await request.formData();
		const field = (key: string) => {
			const value = form.get(key);
			return typeof value === 'string' ? value.slice(0, 1000) : '';
		};
		const values: WordInput = {
			word: field('word'),
			partOfSpeech: field('partOfSpeech'),
			definition: field('definition'),
			sentence: field('sentence'),
			synonyms: field('synonyms')
		};

		const result = updateWord(getDb(), idParam(params.list), idParam(params.word), values);
		if (result.status === 'not-found') error(404, 'Word not found');
		if (result.status === 'invalid') return fail(400, { values, errors: result.errors });
		return { saved: true };
	},

	delete: ({ locals, params }) => {
		requireParent(locals);
		const listId = idParam(params.list);
		const result = deleteWord(getDb(), listId, idParam(params.word));
		if (result === 'not-found') error(404, 'Word not found');
		if (result === 'in-use') return fail(409, { inUse: true });
		redirect(303, `/parent/words/${listId}`);
	}
};
