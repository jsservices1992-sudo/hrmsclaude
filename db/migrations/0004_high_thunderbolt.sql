ALTER TABLE "companies" ADD COLUMN "weekly_off_work_treatment" text DEFAULT 'ignore' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "compensatory_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_employee_summaries" ADD COLUMN "off_days_worked" real DEFAULT 0 NOT NULL;