CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`slack_member_id` text NOT NULL,
	`bot_scope` text NOT NULL,
	`last_active_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_members_project_id_idx` ON `team_members` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_project_slack_idx` ON `team_members` (`project_id`,`slack_member_id`);