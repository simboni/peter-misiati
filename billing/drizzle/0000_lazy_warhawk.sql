CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `client` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_person` text,
	`email` text,
	`phone` text,
	`kra_pin` text,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`country` text,
	`currency` text DEFAULT 'KES' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_org_idx` ON `client` (`organization_id`);--> statement-breakpoint
CREATE TABLE `delivery_note` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`invoice_id` text,
	`number` text NOT NULL,
	`delivery_date` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`received_by` text,
	`notes` text,
	`share_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_note_share_token_unique` ON `delivery_note` (`share_token`);--> statement-breakpoint
CREATE INDEX `dn_org_idx` ON `delivery_note` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dn_org_number_idx` ON `delivery_note` (`organization_id`,`number`);--> statement-breakpoint
CREATE TABLE `delivery_note_line` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_note_id` text NOT NULL,
	`item_id` text,
	`description` text NOT NULL,
	`quantity_milli` integer DEFAULT 1000 NOT NULL,
	`unit` text DEFAULT 'unit' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`delivery_note_id`) REFERENCES `delivery_note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dn_line_dn_idx` ON `delivery_note_line` (`delivery_note_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`number` text NOT NULL,
	`type` text DEFAULT 'invoice' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`issue_date` integer NOT NULL,
	`due_date` integer,
	`currency` text DEFAULT 'KES' NOT NULL,
	`notes` text,
	`terms` text,
	`discount_type` text,
	`discount_value` integer DEFAULT 0 NOT NULL,
	`deposit_type` text DEFAULT 'none' NOT NULL,
	`deposit_value` integer DEFAULT 0 NOT NULL,
	`deposit_amount` integer DEFAULT 0 NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`discount_amount` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`amount_paid` integer DEFAULT 0 NOT NULL,
	`balance_due` integer DEFAULT 0 NOT NULL,
	`share_token` text NOT NULL,
	`converted_from_id` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_share_token_unique` ON `invoice` (`share_token`);--> statement-breakpoint
CREATE INDEX `invoice_org_idx` ON `invoice` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invoice_client_idx` ON `invoice` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_org_number_idx` ON `invoice` (`organization_id`,`number`);--> statement-breakpoint
CREATE TABLE `invoice_line` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`item_id` text,
	`description` text NOT NULL,
	`quantity_milli` integer DEFAULT 1000 NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`line_subtotal` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_line_invoice_idx` ON `invoice_line` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `item` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'unit' NOT NULL,
	`tax_rate_bps` integer DEFAULT 1600 NOT NULL,
	`kind` text DEFAULT 'service' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_org_idx` ON `item` (`organization_id`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_org_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_user_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `number_sequence` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`prefix` text NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`padding` integer DEFAULT 4 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seq_org_doctype_idx` ON `number_sequence` (`organization_id`,`doc_type`);--> statement-breakpoint
CREATE TABLE `org_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`legal_name` text,
	`kra_pin` text,
	`vat_registered` integer DEFAULT false NOT NULL,
	`default_vat_rate_bps` integer DEFAULT 1600 NOT NULL,
	`currency` text DEFAULT 'KES' NOT NULL,
	`email` text,
	`phone` text,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`country` text DEFAULT 'Kenya' NOT NULL,
	`logo_url` text,
	`bank_details` text,
	`invoice_footer` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_profile_organization_id_unique` ON `org_profile` (`organization_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`client_id` text NOT NULL,
	`number` text NOT NULL,
	`amount` integer NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`reference` text,
	`paid_at` integer NOT NULL,
	`kind` text DEFAULT 'partial' NOT NULL,
	`note` text,
	`share_token` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_share_token_unique` ON `payment` (`share_token`);--> statement-breakpoint
CREATE INDEX `payment_org_idx` ON `payment` (`organization_id`);--> statement-breakpoint
CREATE INDEX `payment_invoice_idx` ON `payment` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_org_number_idx` ON `payment` (`organization_id`,`number`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
