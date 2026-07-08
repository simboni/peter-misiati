ALTER TABLE `org_profile` ADD `signature_url` text;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `signature_name` text;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `signature_title` text;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `signature_align` text DEFAULT 'right' NOT NULL;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `show_signature` integer DEFAULT false NOT NULL;