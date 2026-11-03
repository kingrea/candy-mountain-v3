ALTER TABLE `projects` RENAME TO `workspaces`;--> statement-breakpoint
DROP INDEX `projects_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
DROP INDEX `projects_organisation_id_idx`;--> statement-breakpoint
CREATE INDEX `workspaces_organisation_id_idx` ON `workspaces` (`organisation_id`);--> statement-breakpoint
ALTER TABLE `project_modules` RENAME TO `workspace_modules`;--> statement-breakpoint
ALTER TABLE `workspace_modules` RENAME COLUMN `project_id` TO `workspace_id`;--> statement-breakpoint
DROP INDEX `project_modules_project_module_idx`;--> statement-breakpoint
DROP INDEX `project_modules_project_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_modules_workspace_module_idx` ON `workspace_modules` (`workspace_id`,`module_id`);--> statement-breakpoint
CREATE INDEX `workspace_modules_workspace_id_idx` ON `workspace_modules` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `activity_events` RENAME COLUMN `project_id` TO `workspace_id`;--> statement-breakpoint
DROP INDEX `activity_events_project_occurred_idx`;--> statement-breakpoint
CREATE INDEX `activity_events_workspace_occurred_idx` ON `activity_events` (`workspace_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `agent_sessions` RENAME COLUMN `project_id` TO `workspace_id`;--> statement-breakpoint
DROP INDEX `agent_sessions_project_created_idx`;--> statement-breakpoint
CREATE INDEX `agent_sessions_workspace_created_idx` ON `agent_sessions` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `chat_threads` RENAME COLUMN `project_id` TO `workspace_id`;--> statement-breakpoint
DROP INDEX `chat_threads_project_actor_activity_idx`;--> statement-breakpoint
CREATE INDEX `chat_threads_workspace_actor_activity_idx` ON `chat_threads` (`workspace_id`,`actor_id`,`last_activity_at`);--> statement-breakpoint
ALTER TABLE `repositories` RENAME COLUMN `project_id` TO `workspace_id`;--> statement-breakpoint
CREATE TABLE `__new_plugin_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`scope` text NOT NULL,
	`workspace_id` text,
	`config` text NOT NULL,
	`health` text,
	`health_checked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plugin_instances_scope_owner" CHECK(("__new_plugin_instances"."scope" = 'workspace' AND "__new_plugin_instances"."workspace_id" IS NOT NULL) OR ("__new_plugin_instances"."scope" = 'global' AND "__new_plugin_instances"."workspace_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_plugin_instances`("id", "type_id", "scope", "workspace_id", "config", "health", "health_checked_at", "created_at", "updated_at") SELECT "id", "type_id", CASE "scope" WHEN 'project' THEN 'workspace' ELSE "scope" END, "project_id", "config", "health", "health_checked_at", "created_at", "updated_at" FROM `plugin_instances`;--> statement-breakpoint
DROP TABLE `plugin_instances`;--> statement-breakpoint
ALTER TABLE `__new_plugin_instances` RENAME TO `plugin_instances`;--> statement-breakpoint
CREATE INDEX `plugin_instances_workspace_id_idx` ON `plugin_instances` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `plugin_instances_type_id_idx` ON `plugin_instances` (`type_id`);
