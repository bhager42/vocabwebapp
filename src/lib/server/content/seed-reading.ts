import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { readingQuestion, readingStory } from '../db/schema.ts';
import type { GradeStories } from './reading.ts';

export interface StorySeedResult {
	inserted: number;
	updated: number;
	unchanged: number;
	retired: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Makes the built-in reading stories in the database match the content files. Safe to
 * run on every startup, like seedBuiltinWords:
 * - Stories are matched by their id (slug) and questions by their position, so database
 *   ids never change and a child's answers keep pointing at the right question.
 * - A story's `active` flag is the parent's choice and is left alone.
 * - A story taken out of the content files is kept (answers refer to it) but switched
 *   off. So is a question past the end of a story that has become shorter.
 */
export function seedStories(db: Db, grades: GradeStories[]): StorySeedResult {
	return db.transaction((tx) => {
		const result: StorySeedResult = { inserted: 0, updated: 0, unchanged: 0, retired: 0 };
		const existing = new Map(
			tx
				.select()
				.from(readingStory)
				.all()
				.map((row) => [row.slug, row])
		);

		for (const { grade, stories } of grades) {
			for (const story of stories) {
				const row = existing.get(story.id);
				existing.delete(story.id);
				const values = { grade, title: story.title, paragraphsJson: story.paragraphs };

				let storyId: number;
				let changed = false;
				if (!row) {
					storyId = tx
						.insert(readingStory)
						.values({ slug: story.id, ...values })
						.returning()
						.get().id;
					result.inserted++;
				} else {
					storyId = row.id;
					if (
						row.grade !== grade ||
						row.title !== story.title ||
						!same(row.paragraphsJson, story.paragraphs)
					) {
						tx.update(readingStory).set(values).where(eq(readingStory.id, row.id)).run();
						changed = true;
					}
				}

				const questions = new Map(
					tx
						.select()
						.from(readingQuestion)
						.where(eq(readingQuestion.storyId, storyId))
						.all()
						.map((entry) => [entry.position, entry])
				);
				story.questions.forEach((question, position) => {
					const current = questions.get(position);
					questions.delete(position);
					const fields = {
						kind: question.kind,
						prompt: question.prompt,
						correct: question.correct,
						wrongJson: question.wrong,
						explanation: question.explanation,
						active: true
					};
					if (!current) {
						tx.insert(readingQuestion)
							.values({ storyId, position, ...fields })
							.run();
						if (row) changed = true;
					} else if (
						current.kind !== fields.kind ||
						current.prompt !== fields.prompt ||
						current.correct !== fields.correct ||
						!same(current.wrongJson, fields.wrongJson) ||
						current.explanation !== fields.explanation ||
						!current.active
					) {
						tx.update(readingQuestion).set(fields).where(eq(readingQuestion.id, current.id)).run();
						changed = true;
					}
				});
				for (const left of questions.values()) {
					if (left.active) {
						tx.update(readingQuestion)
							.set({ active: false })
							.where(eq(readingQuestion.id, left.id))
							.run();
						changed = true;
					}
				}

				if (row) result[changed ? 'updated' : 'unchanged']++;
			}
		}

		// Whatever is left is no longer in the content files.
		for (const row of existing.values()) {
			if (row.active) {
				tx.update(readingStory).set({ active: false }).where(eq(readingStory.id, row.id)).run();
				result.retired++;
			}
		}
		return result;
	});
}
