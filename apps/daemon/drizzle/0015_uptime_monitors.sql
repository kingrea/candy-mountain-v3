CREATE TABLE `uptime_monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`target` text NOT NULL,
	`interval_seconds` integer NOT NULL,
	`enabled` integer NOT NULL,
	`options` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `uptime_monitors_project_id_idx` ON `uptime_monitors` (`project_id`);