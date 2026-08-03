CREATE TABLE `payment_intent` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`client_id` text NOT NULL,
	`amount` integer NOT NULL,
	`phone` text NOT NULL,
	`provider` text DEFAULT 'kopokopo' NOT NULL,
	`provider_ref` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`payment_id` text,
	`mpesa_reference` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pi_org_idx` ON `payment_intent` (`organization_id`);--> statement-breakpoint
CREATE INDEX `pi_invoice_idx` ON `payment_intent` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `pi_provider_ref_idx` ON `payment_intent` (`provider_ref`);--> statement-breakpoint
ALTER TABLE `payment` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `payment` ADD `provider_ref` text;