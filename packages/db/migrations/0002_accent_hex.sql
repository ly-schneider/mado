ALTER TABLE "users" ALTER COLUMN "accent" SET DEFAULT '#58a0f9';--> statement-breakpoint
UPDATE "users" SET "accent" = '#58a0f9' WHERE "accent" NOT LIKE '#%';
