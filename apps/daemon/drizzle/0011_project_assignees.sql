CREATE TABLE `project_assignees` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_assignees_project_name_idx` ON `project_assignees` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `project_assignees_project_id_idx` ON `project_assignees` (`project_id`);