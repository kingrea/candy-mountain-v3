CREATE TABLE `repositories` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`verification` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
