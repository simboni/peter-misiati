ALTER TABLE `org_profile` ADD `kopokopo_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `kopokopo_base_url` text;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `kopokopo_till` text;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `kopokopo_client_id` text;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `kopokopo_client_secret_enc` text;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `kopokopo_api_key_enc` text;