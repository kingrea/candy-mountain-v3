CREATE TABLE `plugin_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`config` text NOT NULL,
	`health` text,
	`health_checked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plugin_instances_scope_owner" CHECK(("plugin_instances"."scope" = 'project' AND "plugin_instances"."project_id" IS NOT NULL) OR ("plugin_instances"."scope" = 'global' AND "plugin_instances"."project_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `plugin_instances_project_id_idx` ON `plugin_instances` (`project_id`);--> statement-breakpoint
CREATE INDEX `plugin_instances_type_id_idx` ON `plugin_instances` (`type_id`);