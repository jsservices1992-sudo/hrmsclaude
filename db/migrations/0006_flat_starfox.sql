CREATE TABLE "rehires" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"company_id" text NOT NULL,
	"previous_date_of_joining" text NOT NULL,
	"previous_date_of_exit" text,
	"previous_exit_id" text,
	"previous_rehire_eligible" text,
	"new_date_of_joining" text NOT NULL,
	"joiner_id" text,
	"reason" text,
	"decided_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "payment_basis" text DEFAULT 'salary' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "tds_nature" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "fee_is_net_of_tds" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rehires" ADD CONSTRAINT "rehires_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehires" ADD CONSTRAINT "rehires_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehires" ADD CONSTRAINT "rehires_previous_exit_id_exit_cases_id_fk" FOREIGN KEY ("previous_exit_id") REFERENCES "public"."exit_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehires" ADD CONSTRAINT "rehires_joiner_id_joiners_id_fk" FOREIGN KEY ("joiner_id") REFERENCES "public"."joiners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rehires_employee_idx" ON "rehires" USING btree ("employee_id");