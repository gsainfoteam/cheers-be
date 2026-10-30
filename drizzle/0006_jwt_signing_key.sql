CREATE TABLE "jwt_signing_key" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"private_key" text NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jwt_signing_key_singleton" CHECK ("jwt_signing_key"."id" = 1)
);
