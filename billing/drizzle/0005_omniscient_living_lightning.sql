CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`target_label` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `admin_audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`price_per_seat_kes` integer DEFAULT 1000 NOT NULL,
	`currency` text DEFAULT 'KES' NOT NULL,
	`kopokopo_enabled` integer DEFAULT false NOT NULL,
	`kopokopo_base_url` text,
	`kopokopo_till` text,
	`kopokopo_client_id` text,
	`kopokopo_client_secret_enc` text,
	`kopokopo_api_key_enc` text,
	`resend_api_key_enc` text,
	`resend_from` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `org_profile` ADD `plan_activated_at` integer;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `plan_price_override_kes` integer;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `suspended` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `admin_note` text;--> statement-breakpoint
ALTER TABLE `user` ADD `is_platform_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `is_super_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `disabled` integer DEFAULT false NOT NULL;