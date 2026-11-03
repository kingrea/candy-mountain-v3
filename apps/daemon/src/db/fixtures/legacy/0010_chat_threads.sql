CREATE TABLE `chat_thread_sessions` (
	`thread_id` text NOT NULL,
	`session_id` text NOT NULL,
	`model` text,
	`effort` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`thread_id`, `session_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`current_session_id` text NOT NULL,
	`title` text,
	`model` text,
	`effort` text,
	`unread` integer DEFAULT false NOT NULL,
	`working` integer DEFAULT false NOT NULL,
	`last_read_at` text,
	`last_activity_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_threads_project_actor_activity_idx` ON `chat_threads` (`project_id`,`actor_id`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `chat_threads_current_session_idx` ON `chat_threads` (`current_session_id`);