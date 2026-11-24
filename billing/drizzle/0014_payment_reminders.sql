ALTER TABLE `org_profile` ADD `reminders_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `reminder_schedule` text DEFAULT '-3,0,3,7,14' NOT NULL;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `reminder_tone` text DEFAULT 'friendly' NOT NULL;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `reminder_auto_email` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `org_profile` ADD `reminder_min_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `client` ADD `reminders_opt_out` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `reminders_paused` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE `invoice_reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`step` integer NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`tone` text,
	`detail` text,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_reminder_invoice_idx` ON `invoice_reminder` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_reminder_org_sent_idx` ON `invoice_reminder` (`organization_id`,`sent_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_reminder_invoice_step_idx` ON `invoice_reminder` (`invoice_id`,`step`);
