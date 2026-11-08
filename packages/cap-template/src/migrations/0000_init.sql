CREATE TABLE `template_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `template_notes_workspace_id_idx` ON `template_notes` (`workspace_id`);