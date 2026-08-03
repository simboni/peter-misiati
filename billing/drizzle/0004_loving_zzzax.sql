ALTER TABLE `org_profile` ADD `plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `plan_requested_at` integer;