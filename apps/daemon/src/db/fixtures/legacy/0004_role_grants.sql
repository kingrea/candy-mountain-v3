CREATE TABLE `role_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`rungs` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_grants_role_target_idx` ON `role_grants` (`role_id`,`target_kind`,`target_id`);