import { error, fail, redirect } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { GRADES } from '#lib/server/children.ts';
import { PARTS_OF_SPEECH } from '#lib/server/content/validate.ts';
import { getDb } from '#lib/server/db/index.ts';
import { idParam } from '#lib/server/params.ts';
import {
	addWords,
	alsoListedIn,
	checkList,
	deleteCustomList,
	getWordList,
	parsePastedWords,
	PASTE_MAX,
	setWordActive,
	updateCustomList,
	type WordInput
} from '#lib/server/words.ts';
import type { Actions, PageServerLoad } from './$types';

const text = (form: FormData, key: string) => {
	const value = form.get(key);
	return typeof value === 'string' ? value : '';
};
const texts = (form: FormData, key: string) =>
	form.getAll(key).map((value) => (typeof value === 'string' ? value : ''));

export const load: PageServerLoad = ({ locals, params }) => {
	requireParent(locals);
	const list = getWordList(getDb(), idParam(params.list));
	if (!list) error(404, 'List not found');
	return { list, grades: [...GRADES], partsOfSpeech: [...PARTS_OF_SPEECH], pasteMax: PASTE_MAX };
};

export const actions: Actions = {
	/** Switches one word on or off. */
	toggle: async ({ locals, params, request }) => {
		requireParent(locals);
		const form = await request.formData();
		const wordId = idParam(text(form, 'id'));
		const active = text(form, 'active') === 'true';
		if (!setWordActive(getDb(), idParam(params.list), wordId, active)) {
			error(404, 'Word not found');
		}
		return { toggled: wordId };
	},

	/** Renames one of the parent's own lists or changes its grade. */
	rename: async ({ locals, params, request }) => {
		requireParent(locals);
		const form = await request.formData();
		const checked = checkList({ name: text(form, 'name'), grade: text(form, 'grade') });
		if (!checked.ok) return fail(400, { listErrors: checked.errors });

		const result = updateCustomList(getDb(), idParam(params.list), checked.data);
		if (!result) error(404, 'List not found');
		if (!result.ok) return fail(400, { listErrors: result.errors });
		return { renamed: true };
	},

	delete: ({ locals, params }) => {
		requireParent(locals);
		const result = deleteCustomList(getDb(), idParam(params.list));
		if (result === 'not-found') error(404, 'List not found');
		if (result === 'in-use') return fail(409, { inUse: true });
		redirect(303, '/parent/words');
	},

	/**
	 * First step of adding words: takes the pasted words and sends back one blank entry
	 * for each, to be filled in. Nothing is saved yet.
	 */
	paste: async ({ locals, params, request }) => {
		requireParent(locals);
		const db = getDb();
		const list = getWordList(db, idParam(params.list));
		if (!list || list.source !== 'custom') error(404, 'List not found');

		const pasted = text(await request.formData(), 'pasted').slice(0, 5000);
		const { words, rejected } = parsePastedWords(pasted);
		const have = new Set(list.entries.map((entry) => entry.word));
		const fresh = words.filter((entry) => !have.has(entry));
		const skipped = words.filter((entry) => have.has(entry));

		if (fresh.length === 0) {
			return fail(400, {
				pasted,
				pasteError:
					words.length > 0
						? 'Those words are all in the list already.'
						: 'Type or paste at least one word. Each must be a single word, letters only.'
			});
		}

		const elsewhere = alsoListedIn(db, fresh, list.id);
		return {
			drafts: fresh.slice(0, PASTE_MAX).map((entry): WordInput & { note?: string } => ({
				word: entry,
				partOfSpeech: '',
				definition: '',
				sentence: '',
				synonyms: '',
				note: elsewhere.has(entry) ? `Also in the list “${elsewhere.get(entry)}”.` : undefined
			})),
			leftOut: [
				...rejected.map((entry) => `“${entry}” is not a single word of letters`),
				...skipped.map((entry) => `“${entry}” is already in the list`),
				...fresh.slice(PASTE_MAX).map((entry) => `“${entry}” is over the limit of ${PASTE_MAX}`)
			]
		};
	},

	/** Second step: saves the filled-in entries, all of them or none. */
	add: async ({ locals, params, request }) => {
		requireParent(locals);
		const form = await request.formData();
		const words = texts(form, 'word').slice(0, PASTE_MAX);
		const [kinds, definitions, sentences, synonyms] = [
			texts(form, 'partOfSpeech'),
			texts(form, 'definition'),
			texts(form, 'sentence'),
			texts(form, 'synonyms')
		];
		const drafts: WordInput[] = words.map((entry, index) => ({
			word: entry.slice(0, 100),
			partOfSpeech: (kinds[index] ?? '').slice(0, 20),
			definition: (definitions[index] ?? '').slice(0, 1000),
			sentence: (sentences[index] ?? '').slice(0, 1000),
			synonyms: (synonyms[index] ?? '').slice(0, 1000)
		}));
		if (drafts.length === 0) error(400, 'No words were sent');

		const result = addWords(getDb(), idParam(params.list), drafts);
		if (result.status === 'not-found') error(404, 'List not found');
		if (result.status === 'invalid') {
			return fail(400, { drafts, draftErrors: result.errors });
		}
		return { added: result.added };
	}
};
