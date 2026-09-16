ALTER TABLE "employee_salaries" ADD COLUMN "pay_mode" text;--> statement-breakpoint
ALTER TABLE "employee_salaries" ADD COLUMN "target_take_home_paise" bigint;--> statement-breakpoint
ALTER TABLE "joiners" ADD COLUMN "offer_pay_mode" text;--> statement-breakpoint
ALTER TABLE "joiners" ADD COLUMN "offered_take_home_paise" bigint;