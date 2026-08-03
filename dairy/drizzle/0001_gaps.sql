ALTER TABLE "animal_exit" ADD COLUMN "counterparty_kind" text;--> statement-breakpoint
ALTER TABLE "animal_exit" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "fodder_production" ADD COLUMN "feed_item_id" uuid;--> statement-breakpoint
ALTER TABLE "health_event" ADD COLUMN "routine" text;--> statement-breakpoint
ALTER TABLE "health_event" ADD COLUMN "is_dry_cow_therapy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_record" ADD COLUMN "recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "leave_record" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "milk_disposal" ADD COLUMN "animal_id" uuid;--> statement-breakpoint
ALTER TABLE "milk_statement_deduction" ADD COLUMN "farm_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "mpesa_statement_line" ADD COLUMN "transaction_status" text;--> statement-breakpoint
ALTER TABLE "mpesa_statement_line" ADD COLUMN "other_party_info" text;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "pregnancy_check" ADD COLUMN "expense_id" uuid;--> statement-breakpoint
ALTER TABLE "standing_order" ADD COLUMN "route_id" uuid;--> statement-breakpoint
ALTER TABLE "fodder_production" ADD CONSTRAINT "fodder_production_feed_item_id_feed_item_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_counterparty_id_counterparty_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparty"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milk_disposal" ADD CONSTRAINT "milk_disposal_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_order" ADD CONSTRAINT "standing_order_route_id_delivery_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."delivery_route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animal_exit" ADD CONSTRAINT "animal_exit_uq" UNIQUE("farm_id","animal_id");