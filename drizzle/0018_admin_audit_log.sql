CREATE TABLE "admin_audit_log" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"admin_email" varchar(64) NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" varchar(64),
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
