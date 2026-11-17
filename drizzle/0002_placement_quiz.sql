CREATE TABLE `placement_answer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quiz_id` integer NOT NULL,
	`grade` integer NOT NULL,
	`word_id` integer NOT NULL,
	`choices_json` text NOT NULL,
	`correct_choice` text NOT NULL,
	`served_at` integer NOT NULL,
	`chosen` text,
	`is_correct` integer,
	`answered_at` integer,
	FOREIGN KEY (`quiz_id`) REFERENCES `placement_quiz`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`word_id`) REFERENCES `word`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `placement_answer_quiz_idx` ON `placement_answer` (`quiz_id`);--> statement-breakpoint
CREATE TABLE `placement_quiz` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`start_grade` integer NOT NULL,
	`result_grade` integer,
	`completed` integer DEFAULT false NOT NULL,
	`cancelled` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `child`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `placement_quiz_child_idx` ON `placement_quiz` (`child_id`,`started_at`);