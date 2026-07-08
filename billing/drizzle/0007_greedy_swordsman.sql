CREATE TABLE `expense` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`expense_date` integer NOT NULL,
	`category` text,
	`payee` text,
	`description` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`reference` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `expense_org_idx` ON `expense` (`organization_id`);--> statement-breakpoint
CREATE INDEX `expense_date_idx` ON `expense` (`expense_date`);