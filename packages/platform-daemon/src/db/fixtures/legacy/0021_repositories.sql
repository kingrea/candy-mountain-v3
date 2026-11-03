CREATE TABLE `repositories` (
	`project_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`verification` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `repositories` (`project_id`, `source`, `verification`, `created_at`, `updated_at`)
SELECT `id`, `source`, `verification`, `created_at`, `updated_at` FROM `projects`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `source`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `verification`;