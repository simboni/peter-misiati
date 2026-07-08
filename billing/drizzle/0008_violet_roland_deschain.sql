CREATE TABLE `recurring_invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`title` text,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`start_date` integer NOT NULL,
	`next_run_date` integer NOT NULL,
	`end_date` integer,
	`max_occurrences` integer,
	`occurrences` integer DEFAULT 0 NOT NULL,
	`due_days` integer DEFAULT 0 NOT NULL,
	`auto_send` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`currency` text DEFAULT 'KES' NOT NULL,
	`notes` text,
	`terms` text,
	`discount_type` text,
	`discount_value` integer DEFAULT 0 NOT NULL,
	`deposit_type` text DEFAULT 'none' NOT NULL,
	`deposit_value` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recur_org_idx` ON `recurring_invoice` (`organization_id`);--> statement-breakpoint
CREATE INDEX `recur_next_idx` ON `recurring_invoice` (`next_run_date`);--> statement-breakpoint
CREATE TABLE `recurring_invoice_line` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_invoice_id` text NOT NULL,
	`item_id` text,
	`title` text,
	`description` text NOT NULL,
	`quantity_milli` integer DEFAULT 1000 NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recurring_invoice_id`) REFERENCES `recurring_invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recur_line_idx` ON `recurring_invoice_line` (`recurring_invoice_id`);