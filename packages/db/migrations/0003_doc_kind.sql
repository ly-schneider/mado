ALTER TABLE "docs" ADD COLUMN "kind" text DEFAULT 'page' NOT NULL;--> statement-breakpoint
UPDATE "docs" d SET "kind" = 'folder' WHERE btrim(d."content") = '' AND EXISTS (SELECT 1 FROM "docs" c WHERE c."parent_id" = d."id");
