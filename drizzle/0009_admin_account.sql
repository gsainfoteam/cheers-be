CREATE TYPE "public"."admin_account_role" AS ENUM('admin', 'superadmin');--> statement-breakpoint
CREATE TABLE "admin_account" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"email" varchar(64) NOT NULL,
	"role" "admin_account_role" DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_account_email_unique" UNIQUE("email")
);
