CREATE TABLE `agent_session_events` (
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `seq`),
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`family` text NOT NULL,
	`actor_id` text NOT NULL,
	`cwd` text NOT NULL,
	`upstream_session_id` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`posture` text,
	`created_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_project_created_idx` ON `agent_sessions` (`project_id`,`created_at`);