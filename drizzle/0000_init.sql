CREATE TABLE `answer` (
	`question_id` integer PRIMARY KEY NOT NULL,
	`chosen` text NOT NULL,
	`is_correct` integer NOT NULL,
	`response_ms` integer NOT NULL,
	`is_retry` integer DEFAULT false NOT NULL,
	`answered_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `question`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auth_session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_session_expires_idx` ON `auth_session` (`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_session_subject_idx` ON `auth_session` (`kind`,`subject_id`);--> statement-breakpoint
CREATE TABLE `child` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`grade` integer DEFAULT 3 NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "child_grade_range" CHECK("child"."grade" between 1 and 12)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_name_normalized_unique` ON `child` (`name_normalized`);--> statement-breakpoint
CREATE TABLE `login_attempt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip` text NOT NULL,
	`at` integer NOT NULL,
	`success` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempt_ip_idx` ON `login_attempt` (`ip`,`at`);--> statement-breakpoint
CREATE TABLE `parent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parent_username_unique` ON `parent` (`username`);--> statement-breakpoint
CREATE TABLE `practice_session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`question_count` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `child`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `practice_session_child_idx` ON `practice_session` (`child_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `question` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`practice_session_id` integer NOT NULL,
	`word_id` integer NOT NULL,
	`type` text NOT NULL,
	`choices_json` text NOT NULL,
	`correct_choice` text NOT NULL,
	`served_at` integer NOT NULL,
	FOREIGN KEY (`practice_session_id`) REFERENCES `practice_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`word_id`) REFERENCES `word`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `question_session_idx` ON `question` (`practice_session_id`);--> statement-breakpoint
CREATE INDEX `question_word_idx` ON `question` (`word_id`);--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `word` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`word` text NOT NULL,
	`part_of_speech` text NOT NULL,
	`definition` text NOT NULL,
	`sentence` text NOT NULL,
	`synonyms_json` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `word_list`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `word_list_word_unique` ON `word` (`list_id`,`word`);--> statement-breakpoint
CREATE TABLE `word_list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`grade` integer NOT NULL,
	`source` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `word_progress` (
	`child_id` integer NOT NULL,
	`word_id` integer NOT NULL,
	`box` integer DEFAULT 1 NOT NULL,
	`due_at` integer NOT NULL,
	`times_seen` integer DEFAULT 0 NOT NULL,
	`times_correct` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`mastered_at` integer,
	PRIMARY KEY(`child_id`, `word_id`),
	FOREIGN KEY (`child_id`) REFERENCES `child`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`word_id`) REFERENCES `word`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "word_progress_box_range" CHECK("word_progress"."box" between 1 and 5)
);
--> statement-breakpoint
CREATE INDEX `word_progress_due_idx` ON `word_progress` (`child_id`,`due_at`);