ALTER TABLE "coffee_chat_request" ADD COLUMN "accepted_at" timestamp with time zone;
UPDATE "coffee_chat_request" SET "accepted_at" = "contact_shared_at" WHERE "contact_shared_at" IS NOT NULL;
