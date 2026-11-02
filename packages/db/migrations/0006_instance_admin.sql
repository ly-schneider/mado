ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing instances: the first account is the one that ran setup.
UPDATE "users" SET "is_admin" = true WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1);
