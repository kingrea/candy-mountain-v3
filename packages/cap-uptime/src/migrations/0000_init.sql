CREATE TABLE `uptime_checks` (
	`id` integer PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`checked_at` text NOT NULL,
	`ok` integer NOT NULL,
	`status` text NOT NULL,
	`http_status` integer,
	`latency_ms` integer NOT NULL,
	`detail` text,
	FOREIGN KEY (`monitor_id`) REFERENCES `uptime_monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `uptime_checks_monitor_id_checked_at_idx` ON `uptime_checks` (`monitor_id`,`checked_at`);--> statement-breakpoint
CREATE TABLE `uptime_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`reason` text NOT NULL,
	`thread_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitor_id`) REFERENCES `uptime_monitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `uptime_incidents_project_opened_idx` ON `uptime_incidents` (`project_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `uptime_incidents_monitor_opened_idx` ON `uptime_incidents` (`monitor_id`,`opened_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uptime_incidents_open_monitor_idx` ON `uptime_incidents` (`monitor_id`) WHERE "uptime_incidents"."closed_at" IS NULL;--> statement-breakpoint
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
	FOREIGN KEY (`project_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `uptime_monitors_project_id_idx` ON `uptime_monitors` (`project_id`);