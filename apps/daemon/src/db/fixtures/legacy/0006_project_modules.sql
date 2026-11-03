CREATE TABLE `project_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`module_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_modules_project_module_idx` ON `project_modules` (`project_id`,`module_id`);--> statement-breakpoint
CREATE INDEX `project_modules_project_id_idx` ON `project_modules` (`project_id`);