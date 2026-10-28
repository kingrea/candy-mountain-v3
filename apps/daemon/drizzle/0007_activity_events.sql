CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`occurred_at` text NOT NULL,
	`link` text,
	`payload` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_events_project_occurred_idx` ON `activity_events` (`project_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `activity_events_type_idx` ON `activity_events` (`type`);