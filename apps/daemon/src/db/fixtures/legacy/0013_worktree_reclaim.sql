ALTER TABLE `worktree_leases` ADD `unpushed_work` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `worktree_leases` ADD `unpushed_reason` text;--> statement-breakpoint
ALTER TABLE `worktree_leases` ADD `inspected_at` text;--> statement-breakpoint
ALTER TABLE `worktree_leases` ADD `dependencies_status` text;--> statement-breakpoint
ALTER TABLE `worktree_leases` ADD `dependencies_output` text;--> statement-breakpoint
ALTER TABLE `worktree_leases` ADD `dependencies_checked_at` text;