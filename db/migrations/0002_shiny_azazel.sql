ALTER TABLE "statutory_params" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "statutory_params" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;