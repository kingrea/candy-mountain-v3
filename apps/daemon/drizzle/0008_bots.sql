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
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bots_project_id_idx` ON `bots` (`project_id`);