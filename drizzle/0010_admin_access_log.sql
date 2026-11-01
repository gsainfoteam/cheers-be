CREATE TYPE "public"."admin_access_target_type" AS ENUM('business_card');--> statement-breakpoint
CREATE TABLE "admin_access_log" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"admin_email" varchar(64) NOT NULL,
	"target_type" "admin_access_target_type" NOT NULL,
	"target_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
