CREATE TABLE `slack_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`session_id` text NOT NULL,
	`slack_member_id` text NOT NULL,
	`prompt_seq` integer NOT NULL,
	`sent_seq` integer DEFAULT 0 NOT NULL,
	`mode` text,
	`message_ts` text,
	`state` text DEFAULT 'open' NOT NULL,
	`resumes` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`thread_id`) REFERENCES `slack_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `slack_turns_thread_id_idx` ON `slack_turns` (`thread_id`);--> statement-breakpoint
CREATE INDEX `slack_turns_state_idx` ON `slack_turns` (`state`);