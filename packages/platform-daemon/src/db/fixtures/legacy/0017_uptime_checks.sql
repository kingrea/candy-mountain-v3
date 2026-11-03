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
CREATE INDEX `uptime_checks_monitor_id_checked_at_idx` ON `uptime_checks` (`monitor_id`,`checked_at`);