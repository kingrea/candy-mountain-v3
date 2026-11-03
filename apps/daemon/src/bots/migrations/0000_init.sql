CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`write_scope` text NOT NULL,
	`base_branch` text,
	`persona_name` text,
	`answers_in` text NOT NULL,
	`persona_status` text DEFAULT 'unverified' NOT NULL,
	`persona_checked_at` text,
	`persona_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bots_project_id_idx` ON `bots` (`project_id`);--> statement-breakpoint
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
	FOREIGN KEY (`project_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_threads_bot_channel_thread_idx` ON `slack_threads` (`bot_id`,`channel_id`,`thread_ts`);--> statement-breakpoint
CREATE INDEX `slack_threads_session_id_idx` ON `slack_threads` (`session_id`);--> statement-breakpoint
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
CREATE INDEX `slack_turns_state_idx` ON `slack_turns` (`state`);--> statement-breakpoint
CREATE TABLE `worktree_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`holder_kind` text NOT NULL,
	`holder_id` text NOT NULL,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	`released_at` text,
	`unpushed_work` integer DEFAULT false NOT NULL,
	`unpushed_reason` text,
	`inspected_at` text,
	`dependencies_status` text,
	`dependencies_output` text,
	`dependencies_checked_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `worktree_leases_project_state_idx` ON `worktree_leases` (`project_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_leases_active_holder_idx` ON `worktree_leases` (`holder_kind`,`holder_id`) WHERE "worktree_leases"."state" = 'active';