-- Not drizzle-kit's table rebuild: inside the migrator's transaction foreign_keys stays on, so dropping agent_sessions would cascade-delete its children.
ALTER TABLE `agent_sessions` ADD `cwd_nullable` text;--> statement-breakpoint
UPDATE `agent_sessions` SET `cwd_nullable` = NULLIF(`cwd`, '');--> statement-breakpoint
ALTER TABLE `agent_sessions` DROP COLUMN `cwd`;--> statement-breakpoint
ALTER TABLE `agent_sessions` RENAME COLUMN `cwd_nullable` TO `cwd`;
