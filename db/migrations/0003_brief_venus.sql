CREATE TABLE "attendance_punches" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"branch_id" text,
	"date" text NOT NULL,
	"at" text NOT NULL,
	"kind" text NOT NULL,
	"latitude" real,
	"longitude" real,
	"accuracy_metres" real,
	"distance_metres" real,
	"accepted" boolean NOT NULL,
	"reason" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "latitude" real;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "longitude" real;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "geofence_metres" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_punches_emp_idx" ON "attendance_punches" USING btree ("employee_id","date");