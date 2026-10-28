CREATE TABLE `slack_deliveries` (
	`bot_id` text NOT NULL,
	`event_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`ts` text NOT NULL,
	`received_at` text NOT NULL,
	PRIMARY KEY(`bot_id`, `event_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_deliveries_bot_message_idx` ON `slack_deliveries` (`bot_id`,`channel_id`,`ts`);--> statement-breakpoint
CREATE TABLE `slack_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`team_id` text,
	`channel_id` text NOT NULL,
	`thread_ts` text NOT NULL,
	`session_id` text NOT NULL,
	`slack_member_id` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_threads_bot_channel_thread_idx` ON `slack_threads` (`bot_id`,`channel_id`,`thread_ts`);--> statement-breakpoint
CREATE INDEX `slack_threads_session_id_idx` ON `slack_threads` (`session_id`);