CREATE TABLE `credit_note` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`invoice_id` text,
	`number` text NOT NULL,
	`issue_date` integer NOT NULL,
	`currency` text DEFAULT 'KES' NOT NULL,
	`reason` text,
	`notes` text,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`applied_to_invoice` integer DEFAULT false NOT NULL,
	`refunded` integer DEFAULT false NOT NULL,
	`refund_method` text,
	`refund_reference` text,
	`share_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_share_token_unique` ON `credit_note` (`share_token`);--> statement-breakpoint
CREATE INDEX `cn_org_idx` ON `credit_note` (`organization_id`);--> statement-breakpoint
CREATE INDEX `cn_invoice_idx` ON `credit_note` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cn_org_number_idx` ON `credit_note` (`organization_id`,`number`);--> statement-breakpoint
CREATE TABLE `credit_note_line` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_note_id` text NOT NULL,
	`title` text,
	`description` text NOT NULL,
	`quantity_milli` integer DEFAULT 1000 NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`line_subtotal` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_note`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cn_line_idx` ON `credit_note_line` (`credit_note_id`);--> statement-breakpoint
ALTER TABLE `invoice` ADD `credited_amount` integer DEFAULT 0 NOT NULL;