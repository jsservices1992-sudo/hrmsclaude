ALTER TABLE "users" ADD COLUMN "invite_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invite_token_expires_at" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_set_at" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_invite_token_idx" ON "users" USING btree ("invite_token");