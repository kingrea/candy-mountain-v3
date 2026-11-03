CREATE TABLE `uptime_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`reason` text NOT NULL,
	`thread_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitor_id`) REFERENCES `uptime_monitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `uptime_incidents_project_opened_idx` ON `uptime_incidents` (`project_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `uptime_incidents_monitor_opened_idx` ON `uptime_incidents` (`monitor_id`,`opened_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uptime_incidents_open_monitor_idx` ON `uptime_incidents` (`monitor_id`) WHERE "uptime_incidents"."closed_at" IS NULL;