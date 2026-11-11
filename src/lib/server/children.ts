import { asc, eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { Db } from './db/client.ts';
import { child } from './db/schema.ts';
import { checkbox, wholeNumber } from './validation.ts';

/** Grades that have a built-in word list. */
export const GRADES = [3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Per-child practice settings. See PLAN.md sections 2.2 to 2.4. */
export interface ChildSettings {
	questionsPerSession: number;
	newWordsPerSession: number;
	/** Whether nearly-mastered words are asked as "type the word" questions. */
	spellingEnabled: boolean;
	/** Minutes of practice per day before the app says "come back tomorrow". 0 means no cap. */
	dailyCapMinutes: number;
	/** Move to the next grade automatically at 80% instead of asking the parent. */
	autoUnlockNextGrade: boolean;
}

export const DEFAULT_SETTINGS: ChildSettings = {
	questionsPerSession: 10,
	newWordsPerSession: 4,
	spellingEnabled: true,
	dailyCapMinutes: 0,
	autoUnlockNextGrade: false
};

export const NAME_MAX_LENGTH = 30;

/** Tidies a typed name: consistent Unicode form, no stray or doubled spaces. */
export function cleanName(name: string): string {
	return name.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/** The form a name is matched in, so "sam", "Sam" and " SAM " are the same child. */
export function normalizeName(name: string): string {
	return cleanName(name).toLowerCase();
}

const nameSchema = v.pipe(
	v.string('Please enter a name.'),
	v.transform(cleanName),
	v.minLength(1, 'Please enter a name.'),
	v.maxLength(NAME_MAX_LENGTH, `A name can be at most ${NAME_MAX_LENGTH} characters.`),
	v.regex(
		/^\p{L}[\p{L}\p{M}' -]*$/u,
		'A name can only contain letters, spaces, hyphens and apostrophes.'
	)
);

const gradeSchema = v.pipe(
	v.string('Please choose a grade.'),
	v.transform(Number),
	v.picklist(GRADES, 'Please choose a grade.')
);

export const newChildSchema = v.object({ name: nameSchema, grade: gradeSchema });

export const editChildSchema = v.pipe(
	v.object({
		name: nameSchema,
		grade: gradeSchema,
		questionsPerSession: wholeNumber('Questions per session', 5, 20),
		newWordsPerSession: wholeNumber('New words per session', 1, 10),
		spellingEnabled: checkbox,
		dailyCapMinutes: wholeNumber('Daily limit', 0, 120),
		autoUnlockNextGrade: checkbox
	}),
	v.forward(
		v.check(
			(input) => input.newWordsPerSession <= input.questionsPerSession,
			'New words per session cannot be more than questions per session.'
		),
		['newWordsPerSession']
	)
);

export type EditChildInput = v.InferOutput<typeof editChildSchema>;

export interface Child {
	id: number;
	name: string;
	grade: number;
	settings: ChildSettings;
	createdAt: Date;
	archivedAt: Date | null;
}

/** Stored settings may be missing newer keys or hold junk; fall back to defaults per key. */
function readSettings(stored: Record<string, unknown>): ChildSettings {
	const settings = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(settings) as (keyof ChildSettings)[]) {
		const value = stored[key];
		if (typeof value === typeof settings[key]) (settings[key] as unknown) = value;
	}
	return settings;
}

const toChild = (row: typeof child.$inferSelect): Child => ({
	id: row.id,
	name: row.name,
	grade: row.grade,
	settings: readSettings(row.settingsJson),
	createdAt: row.createdAt,
	archivedAt: row.archivedAt
});

export function listChildren(db: Db): Child[] {
	return db.select().from(child).orderBy(asc(child.nameNormalized)).all().map(toChild);
}

export function getChild(db: Db, id: number): Child | null {
	const row = db.select().from(child).where(eq(child.id, id)).get();
	return row ? toChild(row) : null;
}

/** The child a typed name belongs to. Archived children are not found. */
export function findChildByName(db: Db, name: string): Child | null {
	const row = db
		.select()
		.from(child)
		.where(eq(child.nameNormalized, normalizeName(name)))
		.get();
	return row && !row.archivedAt ? toChild(row) : null;
}

export type SaveResult = { ok: true; child: Child } | { ok: false; reason: 'name-taken' };

function nameTaken(db: Db, name: string, exceptId?: number): boolean {
	const row = db
		.select({ id: child.id })
		.from(child)
		.where(eq(child.nameNormalized, normalizeName(name)))
		.get();
	return row !== undefined && row.id !== exceptId;
}

/** Adds a child. Names must be unique (ignoring case and spacing), archived children included. */
export function createChild(
	db: Db,
	input: { name: string; grade: number },
	now = new Date()
): SaveResult {
	if (nameTaken(db, input.name)) return { ok: false, reason: 'name-taken' };

	const row = db
		.insert(child)
		.values({
			name: cleanName(input.name),
			nameNormalized: normalizeName(input.name),
			grade: input.grade,
			settingsJson: { ...DEFAULT_SETTINGS },
			createdAt: now
		})
		.returning()
		.get();
	return { ok: true, child: toChild(row) };
}

export function updateChild(db: Db, id: number, input: EditChildInput): SaveResult | null {
	if (!getChild(db, id)) return null;
	if (nameTaken(db, input.name, id)) return { ok: false, reason: 'name-taken' };

	const { name, grade, ...settings } = input;
	const row = db
		.update(child)
		.set({
			name: cleanName(name),
			nameNormalized: normalizeName(name),
			grade,
			settingsJson: { ...settings }
		})
		.where(eq(child.id, id))
		.returning()
		.get();
	return { ok: true, child: toChild(row) };
}

/** Changes only the grade, leaving name and settings alone. */
export function setGrade(db: Db, id: number, grade: number): boolean {
	return db.update(child).set({ grade }).where(eq(child.id, id)).run().changes > 0;
}

/**
 * Archiving hides a child from practice and from the main list but keeps all of their
 * history. Restoring brings them back exactly as they were.
 */
export function setArchived(db: Db, id: number, archived: boolean, now = new Date()): boolean {
	return (
		db
			.update(child)
			.set({ archivedAt: archived ? now : null })
			.where(eq(child.id, id))
			.run().changes > 0
	);
}
