DROP INDEX `login_attempt_ip_idx`;--> statement-breakpoint
ALTER TABLE `login_attempt` ADD `scope` text DEFAULT 'parent' NOT NULL;--> statement-breakpoint
CREATE INDEX `login_attempt_ip_idx` ON `login_attempt` (`scope`,`ip`,`at`);--> statement-breakpoint
ALTER TABLE `practice_session` ADD `plan_json` text DEFAULT '[]' NOT NULL;