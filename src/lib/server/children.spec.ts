import * as v from 'valibot';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	createChild,
	DEFAULT_SETTINGS,
	editChildSchema,
	getChild,
	listChildren,
	newChildSchema,
	normalizeName,
	setArchived,
	updateChild,
	type EditChildInput
} from './children.ts';
import type { Db } from './db/client.ts';
import { child } from './db/schema.ts';
import { createTestDb } from './test-db.ts';

let db: Db;
let close: () => void;

beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

const add = (name: string, grade = 3) => {
	const result = createChild(db, { name, grade });
	if (!result.ok) throw new Error(`could not create ${name}`);
	return result.child;
};

const editForm = (overrides: Record<string, string | undefined> = {}) => {
	const form: Record<string, string | undefined> = {
		name: 'Sam',
		grade: '3',
		questionsPerSession: '10',
		newWordsPerSession: '4',
		spellingEnabled: 'on',
		dailyCapMinutes: '0',
		...overrides
	};
	return Object.fromEntries(Object.entries(form).filter(([, value]) => value !== undefined));
};

const messages = (schema: v.GenericSchema, input: unknown) =>
	v.safeParse(schema, input).issues?.map((issue) => issue.message) ?? [];

describe('normalizeName', () => {
	it('ignores case, outer spaces and doubled spaces', () => {
		expect(normalizeName('  SAM ')).toBe('sam');
		expect(normalizeName('Mary   Jane')).toBe('mary jane');
		expect(normalizeName('José')).toBe(normalizeName('JOSÉ'));
	});
});

describe('child name and grade rules', () => {
	it('accepts ordinary names', () => {
		for (const name of ['Sam', "D'Arcy", 'Mary-Jane', 'José', 'Anna Lee', 'Zoë']) {
			expect(messages(newChildSchema, { name, grade: '3' }), name).toEqual([]);
		}
	});

	it('rejects empty, too long and odd names', () => {
		for (const name of ['', '   ', 'x'.repeat(31), 'Sam123', '<b>Sam</b>', '-Sam', 'Sam!']) {
			expect(messages(newChildSchema, { name, grade: '3' }), name).not.toEqual([]);
		}
	});

	it('accepts only grades that have a word list', () => {
		expect(messages(newChildSchema, { name: 'Sam', grade: '6' })).toEqual([]);
		for (const grade of ['2', '7', '', 'three', '3.5']) {
			expect(messages(newChildSchema, { name: 'Sam', grade }), grade).toEqual([
				'Please choose a grade.'
			]);
		}
	});
});

describe('practice settings rules', () => {
	it('reads a full form, treating a missing checkbox as off', () => {
		const result = v.parse(editChildSchema, editForm({ spellingEnabled: undefined }));

		expect(result).toEqual({
			name: 'Sam',
			grade: 3,
			questionsPerSession: 10,
			newWordsPerSession: 4,
			spellingEnabled: false,
			dailyCapMinutes: 0,
			autoUnlockNextGrade: false
		});
	});

	it.each([
		['questionsPerSession', '4'],
		['questionsPerSession', '21'],
		['questionsPerSession', 'ten'],
		['questionsPerSession', '7.5'],
		['newWordsPerSession', '0'],
		['newWordsPerSession', '11'],
		['dailyCapMinutes', '-5'],
		['dailyCapMinutes', '121']
	])('rejects %s = %s', (field, value) => {
		const form = editForm({ questionsPerSession: '20', [field]: value });
		expect(messages(editChildSchema, form)).toHaveLength(1);
	});

	it('rejects more new words than questions', () => {
		expect(
			messages(editChildSchema, editForm({ questionsPerSession: '5', newWordsPerSession: '6' }))
		).toEqual(['New words per session cannot be more than questions per session.']);
	});
});

describe('children', () => {
	it('adds a child with the default settings', () => {
		const sam = add('  Sam ', 4);

		expect(sam).toMatchObject({
			name: 'Sam',
			grade: 4,
			settings: DEFAULT_SETTINGS,
			archivedAt: null
		});
		expect(getChild(db, sam.id)).toEqual(sam);
	});

	it('refuses a second child whose name differs only by case or spacing', () => {
		add('Sam');

		expect(createChild(db, { name: ' sAM ', grade: 3 })).toEqual({
			ok: false,
			reason: 'name-taken'
		});
		expect(listChildren(db)).toHaveLength(1);
	});

	it('still counts an archived child when checking for a taken name', () => {
		const sam = add('Sam');
		setArchived(db, sam.id, true);

		expect(createChild(db, { name: 'Sam', grade: 3 }).ok).toBe(false);
	});

	it('lists children in name order', () => {
		add('zoe');
		add('Adam');
		add('Mia');

		expect(listChildren(db).map((entry) => entry.name)).toEqual(['Adam', 'Mia', 'zoe']);
	});

	it('saves a new name, grade and settings', () => {
		const sam = add('Sam');
		const input: EditChildInput = {
			name: 'Samuel',
			grade: 5,
			questionsPerSession: 15,
			newWordsPerSession: 6,
			spellingEnabled: false,
			dailyCapMinutes: 20,
			autoUnlockNextGrade: true
		};

		expect(updateChild(db, sam.id, input)).toMatchObject({ ok: true });
		expect(getChild(db, sam.id)).toMatchObject({
			name: 'Samuel',
			grade: 5,
			settings: {
				questionsPerSession: 15,
				newWordsPerSession: 6,
				spellingEnabled: false,
				dailyCapMinutes: 20,
				autoUnlockNextGrade: true
			}
		});
	});

	it('lets a child keep their own name when saving, but not take a sibling’s', () => {
		const sam = add('Sam');
		add('Mia');
		const input: EditChildInput = { ...DEFAULT_SETTINGS, name: 'sam', grade: 3 };

		expect(updateChild(db, sam.id, input)).toMatchObject({ ok: true });
		expect(updateChild(db, sam.id, { ...input, name: 'MIA' })).toEqual({
			ok: false,
			reason: 'name-taken'
		});
		expect(getChild(db, sam.id)?.name).toBe('sam');
	});

	it('returns null when saving a child that does not exist', () => {
		expect(updateChild(db, 999, { ...DEFAULT_SETTINGS, name: 'Sam', grade: 3 })).toBeNull();
	});

	it('archives and restores without losing anything', () => {
		const sam = add('Sam', 4);

		expect(setArchived(db, sam.id, true)).toBe(true);
		expect(getChild(db, sam.id)?.archivedAt).toBeInstanceOf(Date);

		expect(setArchived(db, sam.id, false)).toBe(true);
		expect(getChild(db, sam.id)).toEqual(sam);

		expect(setArchived(db, 999, true)).toBe(false);
	});

	it('falls back to defaults for settings that are missing or the wrong type', () => {
		const sam = add('Sam');
		db.update(child)
			.set({ settingsJson: { questionsPerSession: 'lots', spellingEnabled: false, extra: 1 } })
			.run();

		expect(getChild(db, sam.id)?.settings).toEqual({ ...DEFAULT_SETTINGS, spellingEnabled: false });
	});
});
