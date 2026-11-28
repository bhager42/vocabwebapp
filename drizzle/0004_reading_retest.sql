CREATE TABLE `reading_retest` (
	`child_id` integer NOT NULL,
	`story_id` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`child_id`, `story_id`),
	FOREIGN KEY (`child_id`) REFERENCES `child`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `reading_story`(`id`) ON UPDATE no action ON DELETE cascade
);
