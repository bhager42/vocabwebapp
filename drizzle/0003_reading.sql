CREATE TABLE `reading_answer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempt_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`choices_json` text NOT NULL,
	`correct_choice` text NOT NULL,
	`served_at` integer NOT NULL,
	`chosen` text,
	`is_correct` integer,
	`response_ms` integer,
	`answered_at` integer,
	FOREIGN KEY (`attempt_id`) REFERENCES `reading_attempt`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `reading_question`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `reading_answer_attempt_idx` ON `reading_answer` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `reading_attempt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`story_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`completed` integer DEFAULT false NOT NULL,
	`active_ms` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `child`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `reading_story`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `reading_attempt_child_idx` ON `reading_attempt` (`child_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `reading_question` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`correct` text NOT NULL,
	`wrong_json` text NOT NULL,
	`explanation` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `reading_story`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reading_question_story_position` ON `reading_question` (`story_id`,`position`);--> statement-breakpoint
CREATE TABLE `reading_story` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`grade` integer NOT NULL,
	`title` text NOT NULL,
	`paragraphs_json` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reading_story_slug_unique` ON `reading_story` (`slug`);--> statement-breakpoint
-- Hand-edited: drizzle-kit wanted to rebuild the child table, which would cascade-delete
-- every child's practice history (PRAGMA foreign_keys is ignored inside the migration's
-- transaction). Adding the column in place keeps every row and every reference.
ALTER TABLE `child` ADD `reading_grade` integer DEFAULT 3 NOT NULL CHECK (`reading_grade` between 1 and 12);
