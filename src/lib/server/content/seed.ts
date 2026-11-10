import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { word, wordList } from '../db/schema.ts';
import type { GradeContent } from './validate.ts';

export interface SeedResult {
	listsCreated: number;
	inserted: number;
	updated: number;
	unchanged: number;
	deactivated: number;
}

const sameList = (a: string[], b: string[]) =>
	a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Makes the built-in word lists in the database match the content files.
 *
 * Safe to run on every startup:
 * - Words are matched by (list, word), so ids never change and a child's progress and
 *   answer history are never touched.
 * - The `active` flag is the parent's choice and is left alone on existing words.
 * - A word removed from the content files is kept (history refers to it) but deactivated.
 *   If it is later added back it stays inactive until the parent re-enables it.
 */
export function seedBuiltinWords(db: Db, grades: GradeContent[]): SeedResult {
	return db.transaction((tx) => {
		const result: SeedResult = {
			listsCreated: 0,
			inserted: 0,
			updated: 0,
			unchanged: 0,
			deactivated: 0
		};

		for (const { grade, words } of grades) {
			let list = tx
				.select()
				.from(wordList)
				.where(and(eq(wordList.source, 'builtin'), eq(wordList.grade, grade)))
				.get();

			if (!list) {
				list = tx
					.insert(wordList)
					.values({ name: `Grade ${grade}`, grade, source: 'builtin' })
					.returning()
					.get();
				result.listsCreated++;
			}

			const existing = new Map(
				tx
					.select()
					.from(word)
					.where(eq(word.listId, list.id))
					.all()
					.map((row) => [row.word, row])
			);

			for (const entry of words) {
				const row = existing.get(entry.word);
				existing.delete(entry.word);

				const values = {
					partOfSpeech: entry.partOfSpeech,
					definition: entry.definition,
					sentence: entry.sentence,
					synonymsJson: entry.synonyms
				};

				if (!row) {
					tx.insert(word)
						.values({ listId: list.id, word: entry.word, ...values })
						.run();
					result.inserted++;
				} else if (
					row.partOfSpeech !== values.partOfSpeech ||
					row.definition !== values.definition ||
					row.sentence !== values.sentence ||
					!sameList(row.synonymsJson, values.synonymsJson)
				) {
					tx.update(word).set(values).where(eq(word.id, row.id)).run();
					result.updated++;
				} else {
					result.unchanged++;
				}
			}

			// Whatever is left was in the database but is no longer in the content file.
			for (const row of existing.values()) {
				if (row.active) {
					tx.update(word).set({ active: false }).where(eq(word.id, row.id)).run();
					result.deactivated++;
				}
			}
		}

		return result;
	});
}
