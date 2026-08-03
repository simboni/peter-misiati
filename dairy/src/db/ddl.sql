CREATE TABLE "alert" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"animal_id" uuid,
	"customer_id" uuid,
	"employee_id" uuid,
	"assigned_role" text,
	"action" text NOT NULL,
	"due_on" date NOT NULL,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"resolved_at" timestamp with time zone,
	"outcome" text,
	"resolved_by" uuid,
	"dedupe_key" text NOT NULL,
	CONSTRAINT "alert_dedupe_uq" UNIQUE("farm_id","dedupe_key")
);

CREATE TABLE "animal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"name" text,
	"sex" text NOT NULL,
	"breed_composition" text,
	"primary_breed" text,
	"date_of_birth" date,
	"dob_estimated" boolean DEFAULT false NOT NULL,
	"sire_id" uuid,
	"dam_id" uuid,
	"sire_straw_code" text,
	"origin" text NOT NULL,
	"entered_herd_on" date NOT NULL,
	"purchase_price_kes" numeric(14, 2),
	"klba_reg_no" text,
	"photo_url" text,
	"class_override" text,
	"castrated" boolean DEFAULT false NOT NULL,
	"notes" text,
	CONSTRAINT "animal_tag_uq" UNIQUE("farm_id","tag")
);

CREATE TABLE "animal_exit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"animal_id" uuid NOT NULL,
	"exit_date" date NOT NULL,
	"reason" text NOT NULL,
	"cause" text,
	"value_kes" numeric(14, 2),
	"counterparty_id" uuid,
	"class_at_exit" text,
	"weight_kg" numeric(8, 2),
	"months_pregnant" numeric(3, 1),
	"daily_yield_at_sale_l" numeric(6, 2),
	"days_in_milk_at_sale" integer,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"photo_url" text,
	"phone" text,
	"pin_hash" text NOT NULL,
	"role" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);

CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"worked_on" date NOT NULL,
	"days" numeric(3, 2) DEFAULT '1' NOT NULL,
	"recorded_by" uuid NOT NULL,
	CONSTRAINT "attendance_uq" UNIQUE("employee_id","worked_on")
);

CREATE TABLE "audit_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb
);

CREATE TABLE "calving" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"dam_id" uuid NOT NULL,
	"service_id" uuid,
	"calved_on" date NOT NULL,
	"calving_ease" smallint,
	"number_born" smallint DEFAULT 1 NOT NULL,
	"retained_placenta" boolean DEFAULT false NOT NULL,
	"milk_fever" boolean DEFAULT false NOT NULL,
	"assisted_by" uuid,
	"notes" text,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "calving_outcome" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"calving_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"calf_sex" text,
	"birth_weight_kg" numeric(6, 2),
	"animal_id" uuid
);

CREATE TABLE "compliance_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"reference_no" text,
	"holder_employee_id" uuid,
	"issued_on" date,
	"expires_on" date NOT NULL,
	"cost_kes" numeric(14, 2),
	"document_url" text
);

CREATE TABLE "counterparty" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"customer_id" uuid,
	"types" text[] NOT NULL,
	"provider_kind" text,
	"kvb_reg_no" text,
	"phone" text,
	"payment_terms" text,
	"credit_balance_kes" numeric(14, 2) DEFAULT '0'
);

CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"customer_type" text NOT NULL,
	"institution_kind" text,
	"phone" text,
	"location" text,
	"area_class" text DEFAULT 'RURAL' NOT NULL,
	"fulfilment" text DEFAULT 'DELIVERED' NOT NULL,
	"route_id" uuid,
	"payment_terms" text DEFAULT 'CASH' NOT NULL,
	"settlement_day" smallint,
	"credit_limit_kes" numeric(14, 2),
	"contract_ref" text,
	"kra_pin" text,
	"requires_invoice" boolean DEFAULT false NOT NULL,
	"requires_delivery_note" boolean DEFAULT false NOT NULL,
	"agpo_category" text,
	"avg_days_to_pay" numeric(6, 1),
	"worst_days_to_pay" integer,
	"active" boolean DEFAULT true NOT NULL,
	"suspended_reason" text,
	"started_on" date,
	"ended_on" date
);

CREATE TABLE "customer_ledger_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"entry_type" text NOT NULL,
	"litres" numeric(8, 2),
	"rate_kes_per_litre" numeric(8, 2),
	"debit_kes" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit_kes" numeric(14, 2) DEFAULT '0' NOT NULL,
	"milk_disposal_id" uuid,
	"payment_method" text,
	"mpesa_ref" text,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"approved_by" uuid
);

CREATE TABLE "delivery_route" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rider_id" uuid,
	"session" text
);

CREATE TABLE "dry_off" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"animal_id" uuid NOT NULL,
	"dried_on" date NOT NULL,
	"method" text,
	"dry_cow_therapy_product_id" uuid,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"app_user_id" uuid,
	"full_name" text NOT NULL,
	"national_id" text,
	"kra_pin" text,
	"nssf_no" text,
	"sha_no" text,
	"phone" text,
	"role" text NOT NULL,
	"employment_type" text NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"basic_wage_kes" numeric(14, 2),
	"wage_period" text,
	"housing_provided" boolean DEFAULT true NOT NULL,
	"next_of_kin" text
);

CREATE TABLE "expense" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"incurred_on" date NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"counterparty_id" uuid,
	"amount_kes" numeric(14, 2) NOT NULL,
	"payment_method" text,
	"mpesa_ref" text,
	"voucher_no" text,
	"attachment_url" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"approved_by" uuid
);

CREATE TABLE "farm" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"county" text,
	"system_type" text DEFAULT 'ZERO_GRAZING' NOT NULL,
	"milking_sessions" smallint DEFAULT 2 NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"area_class" text DEFAULT 'RURAL' NOT NULL,
	"member_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "feed_issue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"feed_item_id" uuid NOT NULL,
	"issued_on" date NOT NULL,
	"animal_group" text,
	"animal_id" uuid,
	"quantity" numeric(10, 3) NOT NULL,
	"unit" text NOT NULL,
	"unit_weight_kg" numeric(8, 3) NOT NULL,
	"animals_fed" smallint,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "feed_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"dm_pct" numeric(5, 2),
	"cp_pct" numeric(5, 2),
	"default_unit" text NOT NULL,
	"default_unit_weight_kg" numeric(8, 3),
	"home_grown" boolean DEFAULT false NOT NULL
);

CREATE TABLE "feed_purchase" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"feed_item_id" uuid NOT NULL,
	"supplier_id" uuid,
	"purchased_on" date NOT NULL,
	"quantity" numeric(10, 3) NOT NULL,
	"unit" text NOT NULL,
	"unit_weight_kg" numeric(8, 3) NOT NULL,
	"unit_price_kes" numeric(14, 2) NOT NULL,
	"total_cost_kes" numeric(14, 2) NOT NULL,
	"expense_id" uuid,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "fodder_production" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"plot_name" text,
	"crop" text NOT NULL,
	"area_acres" numeric(8, 3),
	"planted_on" date,
	"harvested_on" date,
	"quantity" numeric(10, 3),
	"unit" text,
	"unit_weight_kg" numeric(8, 3),
	"input_cost_kes" numeric(14, 2)
);

CREATE TABLE "health_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"animal_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"occurred_on" date NOT NULL,
	"signs" text,
	"diagnosis" text,
	"product_id" uuid,
	"batch_no" text,
	"expiry" date,
	"dose" text,
	"route" text,
	"quarters_treated" text[],
	"duration_days" smallint,
	"treatment_end_on" date,
	"milk_clear_at" timestamp with time zone,
	"meat_clear_at" date,
	"cmt_score" text,
	"performed_by_user" uuid,
	"performed_by_ext" uuid,
	"cost_kes" numeric(14, 2),
	"cost_settled_by" text,
	"outcome" text,
	"follow_up_on" date,
	"expense_id" uuid,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "heat_observation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"animal_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"sign" text,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "income" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"source" text NOT NULL,
	"description" text,
	"counterparty_id" uuid,
	"customer_id" uuid,
	"amount_kes" numeric(14, 2) NOT NULL,
	"payment_method" text,
	"mpesa_ref" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"approved_by" uuid
);

CREATE TABLE "leave_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"days" numeric(5, 2) NOT NULL
);

CREATE TABLE "milk_disposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"disposed_on" date NOT NULL,
	"session" text,
	"channel" text NOT NULL,
	"customer_id" uuid,
	"litres" numeric(8, 2) NOT NULL,
	"rate_kes_per_litre" numeric(8, 2),
	"value_kes" numeric(14, 2),
	"settlement" text,
	"butterfat_pct" numeric(4, 2),
	"protein_pct" numeric(4, 2),
	"snf_pct" numeric(4, 2),
	"lactometer_reading" numeric(6, 4),
	"alcohol_test" text,
	"accepted" boolean,
	"loss_reason" text,
	"delivery_note_no" text,
	"delivered_by" uuid,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "milk_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"animal_id" uuid NOT NULL,
	"recorded_on" date NOT NULL,
	"session" text NOT NULL,
	"litres" numeric(6, 2) NOT NULL,
	"saleable" boolean DEFAULT true NOT NULL,
	"not_saleable_reason" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"supersedes_id" uuid,
	"recorded_by" uuid NOT NULL,
	"approved_by" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone
);

CREATE TABLE "milk_statement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"member_no" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"coop_litres" numeric(10, 2) NOT NULL,
	"rate_kes_per_litre" numeric(8, 2),
	"quality_bonus_kes" numeric(14, 2) DEFAULT '0',
	"gross_pay_kes" numeric(14, 2) NOT NULL,
	"cess_kes" numeric(14, 2) DEFAULT '0',
	"net_pay_kes" numeric(14, 2) NOT NULL,
	"paid_on" date,
	"payment_method" text,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "milk_statement_deduction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"statement_id" uuid NOT NULL,
	"deduction_type" text NOT NULL,
	"description" text,
	"amount_kes" numeric(14, 2) NOT NULL,
	"balance_remaining_kes" numeric(14, 2),
	"matched_expense_id" uuid
);

CREATE TABLE "mpesa_statement_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"receipt_no" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"details" text,
	"paid_in_kes" numeric(14, 2),
	"withdrawn_kes" numeric(14, 2),
	"balance_kes" numeric(14, 2),
	"matched_expense_id" uuid,
	"matched_income_id" uuid,
	CONSTRAINT "mpesa_receipt_uq" UNIQUE("farm_id","receipt_no")
);

CREATE TABLE "payroll_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"approved_by" uuid,
	"total_gross_kes" numeric(14, 2),
	"total_net_kes" numeric(14, 2),
	CONSTRAINT "payroll_period_uq" UNIQUE("farm_id","period_month")
);

CREATE TABLE "payslip" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"days_worked" numeric(5, 2),
	"basic_kes" numeric(14, 2) NOT NULL,
	"housing_allow_kes" numeric(14, 2) DEFAULT '0',
	"gross_kes" numeric(14, 2) NOT NULL,
	"nssf_tier1_kes" numeric(14, 2) DEFAULT '0',
	"nssf_tier2_kes" numeric(14, 2) DEFAULT '0',
	"shif_kes" numeric(14, 2) DEFAULT '0',
	"housing_levy_kes" numeric(14, 2) DEFAULT '0',
	"taxable_kes" numeric(14, 2),
	"paye_before_relief_kes" numeric(14, 2) DEFAULT '0',
	"personal_relief_kes" numeric(14, 2) DEFAULT '2400',
	"paye_kes" numeric(14, 2) DEFAULT '0',
	"advances_kes" numeric(14, 2) DEFAULT '0',
	"other_deductions_kes" numeric(14, 2) DEFAULT '0',
	"milk_ration_kes" numeric(14, 2) DEFAULT '0',
	"net_kes" numeric(14, 2) NOT NULL,
	"employer_nssf_kes" numeric(14, 2) DEFAULT '0',
	"employer_shif_kes" numeric(14, 2) DEFAULT '0',
	"employer_housing_levy_kes" numeric(14, 2) DEFAULT '0',
	"paid_on" date,
	"payment_method" text,
	"mpesa_ref" text,
	CONSTRAINT "payslip_uq" UNIQUE("payroll_run_id","employee_id")
);

CREATE TABLE "pregnancy_check" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"service_id" uuid,
	"animal_id" uuid NOT NULL,
	"checked_on" date NOT NULL,
	"method" text NOT NULL,
	"result" text NOT NULL,
	"months_pregnant" numeric(3, 1),
	"performed_by" uuid,
	"cost_kes" numeric(14, 2),
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "price_list" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"customer_type" text,
	"customer_id" uuid,
	"rate_kes_per_litre" numeric(8, 2) NOT NULL,
	"min_litres" numeric(8, 2),
	"effective_from" date NOT NULL,
	"effective_to" date,
	"reason" text,
	"set_by" uuid NOT NULL
);

CREATE TABLE "product" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid,
	"name" text NOT NULL,
	"active_ingredient" text,
	"product_type" text NOT NULL,
	"milk_withdrawal_days" smallint,
	"meat_withdrawal_days" smallint,
	"label_source" text,
	"not_for_lactating" boolean DEFAULT false NOT NULL
);

CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"lpo_number" text NOT NULL,
	"issued_on" date,
	"expires_on" date,
	"value_kes" numeric(14, 2),
	"litres_committed" numeric(10, 2),
	"status" text DEFAULT 'OPEN' NOT NULL
);

CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"ref_code" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb,
	CONSTRAINT "receipt_ref_uq" UNIQUE("farm_id","ref_code")
);

CREATE TABLE "reference_value" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"value_numeric" numeric(14, 4),
	"value_text" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"source" text
);

CREATE TABLE "routine_schedule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"routine" text NOT NULL,
	"first_dose_min_age_days" integer,
	"first_dose_max_age_days" integer,
	"booster_interval_days" integer,
	"sex_restriction" text,
	"once_in_lifetime" boolean DEFAULT false NOT NULL
);

CREATE TABLE "sales_invoice" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_no" text NOT NULL,
	"issued_on" date NOT NULL,
	"period_start" date,
	"period_end" date,
	"total_litres" numeric(10, 2),
	"subtotal_kes" numeric(14, 2) NOT NULL,
	"tax_kes" numeric(14, 2) DEFAULT '0',
	"total_kes" numeric(14, 2) NOT NULL,
	"due_on" date,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"lpo_id" uuid,
	"etims_ref" text,
	CONSTRAINT "invoice_no_uq" UNIQUE("farm_id","invoice_no")
);

CREATE TABLE "service" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"animal_id" uuid NOT NULL,
	"served_on" date NOT NULL,
	"service_type" text NOT NULL,
	"semen_type" text,
	"straw_code" text,
	"straw_batch" text,
	"sire_breed" text,
	"bull_id" uuid,
	"inseminator_id" uuid,
	"service_number" smallint DEFAULT 1 NOT NULL,
	"cost_kes" numeric(14, 2),
	"cost_settled_by" text,
	"expected_return_on" date,
	"pd_due_on" date,
	"expected_calving_on" date,
	"recorded_by" uuid NOT NULL
);

CREATE TABLE "standing_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"litres" numeric(6, 2) NOT NULL,
	"session" text NOT NULL,
	"days_of_week" smallint[] NOT NULL,
	"rate_kes_per_litre" numeric(8, 2),
	"active_from" date NOT NULL,
	"active_to" date,
	"paused_from" date,
	"paused_to" date
);

CREATE TABLE "support_ticket" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"screen" text,
	"sync_state" jsonb,
	"message" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolved_at" timestamp with time zone
);

CREATE TABLE "training_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"training_event_id" uuid NOT NULL,
	"employee_id" uuid,
	"attendee_name" text
);

CREATE TABLE "training_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text,
	"held_on" date,
	"trainer" text,
	"topic" text,
	"cost_kes" numeric(14, 2),
	"materials_url" text,
	"expense_id" uuid
);

CREATE TABLE "weight_observation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"animal_id" uuid NOT NULL,
	"observed_on" date NOT NULL,
	"weight_kg" numeric(8, 2),
	"method" text,
	"bcs" numeric(3, 2),
	"recorded_by" uuid NOT NULL
);

ALTER TABLE "alert" ADD CONSTRAINT "alert_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "alert" ADD CONSTRAINT "alert_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "alert" ADD CONSTRAINT "alert_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "animal" ADD CONSTRAINT "animal_farm_id_farm_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farm"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "animal" ADD CONSTRAINT "animal_sire_id_animal_id_fk" FOREIGN KEY ("sire_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "animal" ADD CONSTRAINT "animal_dam_id_animal_id_fk" FOREIGN KEY ("dam_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "animal_exit" ADD CONSTRAINT "animal_exit_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_farm_id_farm_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farm"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "calving" ADD CONSTRAINT "calving_dam_id_animal_id_fk" FOREIGN KEY ("dam_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "calving" ADD CONSTRAINT "calving_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "calving_outcome" ADD CONSTRAINT "calving_outcome_calving_id_calving_id_fk" FOREIGN KEY ("calving_id") REFERENCES "public"."calving"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "calving_outcome" ADD CONSTRAINT "calving_outcome_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_document" ADD CONSTRAINT "compliance_document_holder_employee_id_employee_id_fk" FOREIGN KEY ("holder_employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "counterparty" ADD CONSTRAINT "counterparty_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer" ADD CONSTRAINT "customer_farm_id_farm_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farm"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer" ADD CONSTRAINT "customer_route_id_delivery_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."delivery_route"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_milk_disposal_id_milk_disposal_id_fk" FOREIGN KEY ("milk_disposal_id") REFERENCES "public"."milk_disposal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_route" ADD CONSTRAINT "delivery_route_rider_id_app_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dry_off" ADD CONSTRAINT "dry_off_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "employee" ADD CONSTRAINT "employee_app_user_id_app_user_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expense" ADD CONSTRAINT "expense_counterparty_id_counterparty_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparty"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "feed_issue" ADD CONSTRAINT "feed_issue_feed_item_id_feed_item_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_item"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "feed_issue" ADD CONSTRAINT "feed_issue_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "feed_purchase" ADD CONSTRAINT "feed_purchase_feed_item_id_feed_item_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_item"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "health_event" ADD CONSTRAINT "health_event_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "health_event" ADD CONSTRAINT "health_event_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "heat_observation" ADD CONSTRAINT "heat_observation_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "income" ADD CONSTRAINT "income_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "leave_record" ADD CONSTRAINT "leave_record_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "milk_disposal" ADD CONSTRAINT "milk_disposal_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "milk_record" ADD CONSTRAINT "milk_record_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "milk_record" ADD CONSTRAINT "milk_record_supersedes_id_milk_record_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."milk_record"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "milk_statement" ADD CONSTRAINT "milk_statement_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "milk_statement_deduction" ADD CONSTRAINT "milk_statement_deduction_statement_id_milk_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."milk_statement"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mpesa_statement_line" ADD CONSTRAINT "mpesa_statement_line_matched_expense_id_expense_id_fk" FOREIGN KEY ("matched_expense_id") REFERENCES "public"."expense"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mpesa_statement_line" ADD CONSTRAINT "mpesa_statement_line_matched_income_id_income_id_fk" FOREIGN KEY ("matched_income_id") REFERENCES "public"."income"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_payroll_run_id_payroll_run_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_run"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pregnancy_check" ADD CONSTRAINT "pregnancy_check_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pregnancy_check" ADD CONSTRAINT "pregnancy_check_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reference_value" ADD CONSTRAINT "reference_value_farm_id_farm_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farm"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_lpo_id_purchase_order_id_fk" FOREIGN KEY ("lpo_id") REFERENCES "public"."purchase_order"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "service" ADD CONSTRAINT "service_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "service" ADD CONSTRAINT "service_bull_id_animal_id_fk" FOREIGN KEY ("bull_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "standing_order" ADD CONSTRAINT "standing_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_raised_by_app_user_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "training_attendance" ADD CONSTRAINT "training_attendance_training_event_id_training_event_id_fk" FOREIGN KEY ("training_event_id") REFERENCES "public"."training_event"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "training_attendance" ADD CONSTRAINT "training_attendance_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "training_event" ADD CONSTRAINT "training_event_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "weight_observation" ADD CONSTRAINT "weight_observation_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "alert_due_idx" ON "alert" USING btree ("farm_id","due_on","resolved_at");
CREATE INDEX "animal_farm_idx" ON "animal" USING btree ("farm_id");
CREATE INDEX "animal_exit_idx" ON "animal_exit" USING btree ("farm_id","animal_id");
CREATE INDEX "app_user_farm_idx" ON "app_user" USING btree ("farm_id","active");
CREATE INDEX "audit_row_idx" ON "audit_entry" USING btree ("farm_id","table_name","row_id");
CREATE INDEX "calving_dam_idx" ON "calving" USING btree ("farm_id","dam_id","calved_on");
CREATE INDEX "compliance_expiry_idx" ON "compliance_document" USING btree ("farm_id","expires_on");
CREATE INDEX "counterparty_farm_idx" ON "counterparty" USING btree ("farm_id");
CREATE INDEX "customer_farm_idx" ON "customer" USING btree ("farm_id","customer_type","active");
CREATE INDEX "ledger_customer_idx" ON "customer_ledger_entry" USING btree ("farm_id","customer_id","entry_date");
CREATE INDEX "dryoff_animal_idx" ON "dry_off" USING btree ("farm_id","animal_id","dried_on");
CREATE INDEX "employee_farm_idx" ON "employee" USING btree ("farm_id","employment_type");
CREATE INDEX "expense_idx" ON "expense" USING btree ("farm_id","incurred_on","category");
CREATE INDEX "feed_issue_idx" ON "feed_issue" USING btree ("farm_id","issued_on","feed_item_id");
CREATE INDEX "feed_item_farm_idx" ON "feed_item" USING btree ("farm_id","category");
CREATE INDEX "feed_purchase_idx" ON "feed_purchase" USING btree ("farm_id","feed_item_id","purchased_on");
CREATE INDEX "health_animal_idx" ON "health_event" USING btree ("farm_id","animal_id","occurred_on");
CREATE INDEX "health_withdrawal_idx" ON "health_event" USING btree ("farm_id","milk_clear_at");
CREATE INDEX "heat_animal_idx" ON "heat_observation" USING btree ("farm_id","animal_id","observed_at");
CREATE INDEX "income_idx" ON "income" USING btree ("farm_id","received_on","source");
CREATE INDEX "disposal_day_idx" ON "milk_disposal" USING btree ("farm_id","disposed_on");
CREATE INDEX "disposal_customer_idx" ON "milk_disposal" USING btree ("farm_id","customer_id","disposed_on");
CREATE INDEX "milk_day_idx" ON "milk_record" USING btree ("farm_id","recorded_on","animal_id");
CREATE INDEX "milk_animal_idx" ON "milk_record" USING btree ("farm_id","animal_id","recorded_on");
CREATE INDEX "statement_period_idx" ON "milk_statement" USING btree ("farm_id","period_start");
CREATE INDEX "pd_animal_idx" ON "pregnancy_check" USING btree ("farm_id","animal_id","checked_on");
CREATE INDEX "price_lookup_idx" ON "price_list" USING btree ("farm_id","scope","effective_from");
CREATE INDEX "product_farm_idx" ON "product" USING btree ("farm_id","product_type");
CREATE INDEX "receipt_recent_idx" ON "receipt" USING btree ("farm_id","at");
CREATE INDEX "refval_lookup_idx" ON "reference_value" USING btree ("farm_id","kind","key","effective_from");
CREATE INDEX "invoice_due_idx" ON "sales_invoice" USING btree ("farm_id","status","due_on");
CREATE INDEX "service_animal_idx" ON "service" USING btree ("farm_id","animal_id","served_on");
CREATE INDEX "service_edd_idx" ON "service" USING btree ("farm_id","expected_calving_on");
CREATE INDEX "standing_order_idx" ON "standing_order" USING btree ("farm_id","session","customer_id");
CREATE INDEX "weight_animal_idx" ON "weight_observation" USING btree ("farm_id","animal_id","observed_on");ALTER TABLE "animal_exit" ADD COLUMN "counterparty_kind" text;
ALTER TABLE "animal_exit" ADD COLUMN "payment_method" text;
ALTER TABLE "fodder_production" ADD COLUMN "feed_item_id" uuid;
ALTER TABLE "health_event" ADD COLUMN "routine" text;
ALTER TABLE "health_event" ADD COLUMN "is_dry_cow_therapy" boolean DEFAULT false NOT NULL;
ALTER TABLE "leave_record" ADD COLUMN "recorded_by" uuid;
ALTER TABLE "leave_record" ADD COLUMN "approved_by" uuid;
ALTER TABLE "milk_disposal" ADD COLUMN "animal_id" uuid;
ALTER TABLE "milk_statement_deduction" ADD COLUMN "farm_id" uuid NOT NULL;
ALTER TABLE "mpesa_statement_line" ADD COLUMN "transaction_status" text;
ALTER TABLE "mpesa_statement_line" ADD COLUMN "other_party_info" text;
ALTER TABLE "payroll_run" ADD COLUMN "paid_on" date;
ALTER TABLE "pregnancy_check" ADD COLUMN "expense_id" uuid;
ALTER TABLE "standing_order" ADD COLUMN "route_id" uuid;
ALTER TABLE "fodder_production" ADD CONSTRAINT "fodder_production_feed_item_id_feed_item_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_item"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "income" ADD CONSTRAINT "income_counterparty_id_counterparty_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparty"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "milk_disposal" ADD CONSTRAINT "milk_disposal_animal_id_animal_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animal"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "standing_order" ADD CONSTRAINT "standing_order_route_id_delivery_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."delivery_route"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "animal_exit" ADD CONSTRAINT "animal_exit_uq" UNIQUE("farm_id","animal_id");