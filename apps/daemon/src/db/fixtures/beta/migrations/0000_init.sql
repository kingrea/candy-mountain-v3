CREATE TABLE `beta_items` (
	`id` text PRIMARY KEY NOT NULL,
	`thing_id` text NOT NULL,
	FOREIGN KEY (`thing_id`) REFERENCES `alpha_things`(`id`) ON UPDATE no action ON DELETE cascade
);
