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
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `worktree_leases_project_state_idx` ON `worktree_leases` (`project_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_leases_active_holder_idx` ON `worktree_leases` (`holder_kind`,`holder_id`) WHERE "worktree_leases"."state" = 'active';