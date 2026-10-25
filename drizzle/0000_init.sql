CREATE TYPE "public"."attachment_kind" AS ENUM('cv', 'portfolio');--> statement-breakpoint
CREATE TYPE "public"."attachment_source" AS ENUM('file', 'link');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'kakao_alimtalk');--> statement-breakpoint
CREATE TYPE "public"."notification_event" AS ENUM('coffee_chat_requested', 'contact_shared');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('google', 'apple', 'naver');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('student', 'graduated');--> statement-breakpoint
CREATE TABLE "coffee_chat_contact" (
	"user_pk" uuid PRIMARY KEY NOT NULL,
	"kakao_enabled" boolean NOT NULL,
	"email_enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	CONSTRAINT "coffee_chat_contact_kakao_phone_check" CHECK (NOT "coffee_chat_contact"."kakao_enabled" OR "coffee_chat_contact"."phone" IS NOT NULL),
	CONSTRAINT "coffee_chat_contact_email_check" CHECK (NOT "coffee_chat_contact"."email_enabled" OR "coffee_chat_contact"."email" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "coffee_chat_request" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"graduated_pk" uuid NOT NULL,
	"student_pk" uuid NOT NULL,
	"student_profile_pk" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"graduated_viewed_at" timestamp with time zone,
	"contact_shared_at" timestamp with time zone,
	"student_viewed_at" timestamp with time zone,
	"message" text,
	"shared_phone" varchar(20),
	"shared_email" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"type" varchar(64) NOT NULL,
	"version" varchar(32) NOT NULL,
	"is_required" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" varchar(512) NOT NULL,
	CONSTRAINT "consent_type_version_pk" PRIMARY KEY("type","version")
);
--> statement-breakpoint
CREATE TABLE "department" (
	"pk" integer PRIMARY KEY NOT NULL,
	"school_pk" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	CONSTRAINT "department_school_pk_name_unique" UNIQUE("school_pk","name")
);
--> statement-breakpoint
CREATE TABLE "graduated_profile" (
	"graduated_pk" uuid PRIMARY KEY NOT NULL,
	"nickname" varchar(32) NOT NULL,
	"company" varchar(128) NOT NULL,
	"department" varchar(128) NOT NULL,
	"job" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hashtags" text[],
	"links" text[]
);
--> statement-breakpoint
CREATE TABLE "graduated" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"user_pk" uuid NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"business_card_key" text,
	CONSTRAINT "graduated_user_pk_unique" UNIQUE("user_pk")
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"coffee_chat_request_pk" uuid NOT NULL,
	"event" "notification_event" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_id" varchar(128),
	"recipient" varchar(255) NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "refresh_token" (
	"opaque_hash" text PRIMARY KEY NOT NULL,
	"user_pk" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school" (
	"pk" integer PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"email_domain" varchar(128) NOT NULL,
	CONSTRAINT "school_email_domain_unique" UNIQUE("email_domain")
);
--> statement-breakpoint
CREATE TABLE "student_email_verification" (
	"student_pk" uuid PRIMARY KEY NOT NULL,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"code" varchar(6) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_profile_attachment" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"profile_pk" uuid NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"source" "attachment_source" NOT NULL,
	"sort_order" smallint NOT NULL,
	"url" text NOT NULL,
	"file_name" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "student_profile" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"student_pk" uuid NOT NULL,
	"version" integer NOT NULL,
	"department_pk" integer NOT NULL,
	"interests" text[] NOT NULL,
	"activities" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profile_student_pk_version_unique" UNIQUE("student_pk","version"),
	CONSTRAINT "student_profile_pk_student_pk_unique" UNIQUE("pk","student_pk")
);
--> statement-breakpoint
CREATE TABLE "student" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"user_pk" uuid NOT NULL,
	"email" varchar(255),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_user_pk_unique" UNIQUE("user_pk"),
	CONSTRAINT "student_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_consent" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"user_pk" uuid NOT NULL,
	"consent_type" varchar(64) NOT NULL,
	"consent_version" varchar(32) NOT NULL,
	"agreed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_oauth_account" (
	"provider" "oauth_provider" NOT NULL,
	"provider_sub" varchar(255) NOT NULL,
	"user_pk" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"email" varchar(255),
	CONSTRAINT "user_oauth_account_provider_provider_sub_pk" PRIMARY KEY("provider","provider_sub"),
	CONSTRAINT "user_oauth_account_user_pk_provider_unique" UNIQUE("user_pk","provider")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"type" "user_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(64),
	"email" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "coffee_chat_contact" ADD CONSTRAINT "coffee_chat_contact_user_pk_users_pk_fk" FOREIGN KEY ("user_pk") REFERENCES "public"."users"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_chat_request" ADD CONSTRAINT "coffee_chat_request_graduated_pk_graduated_pk_fk" FOREIGN KEY ("graduated_pk") REFERENCES "public"."graduated"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_chat_request" ADD CONSTRAINT "coffee_chat_request_student_pk_student_pk_fk" FOREIGN KEY ("student_pk") REFERENCES "public"."student"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_chat_request" ADD CONSTRAINT "coffee_chat_request_student_profile_fk" FOREIGN KEY ("student_profile_pk","student_pk") REFERENCES "public"."student_profile"("pk","student_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_school_pk_school_pk_fk" FOREIGN KEY ("school_pk") REFERENCES "public"."school"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduated_profile" ADD CONSTRAINT "graduated_profile_graduated_pk_graduated_pk_fk" FOREIGN KEY ("graduated_pk") REFERENCES "public"."graduated"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduated" ADD CONSTRAINT "graduated_user_pk_users_pk_fk" FOREIGN KEY ("user_pk") REFERENCES "public"."users"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_coffee_chat_request_pk_coffee_chat_request_pk_fk" FOREIGN KEY ("coffee_chat_request_pk") REFERENCES "public"."coffee_chat_request"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_pk_users_pk_fk" FOREIGN KEY ("user_pk") REFERENCES "public"."users"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_email_verification" ADD CONSTRAINT "student_email_verification_student_pk_student_pk_fk" FOREIGN KEY ("student_pk") REFERENCES "public"."student"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profile_attachment" ADD CONSTRAINT "student_profile_attachment_profile_pk_student_profile_pk_fk" FOREIGN KEY ("profile_pk") REFERENCES "public"."student_profile"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_student_pk_student_pk_fk" FOREIGN KEY ("student_pk") REFERENCES "public"."student"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_department_pk_department_pk_fk" FOREIGN KEY ("department_pk") REFERENCES "public"."department"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_user_pk_users_pk_fk" FOREIGN KEY ("user_pk") REFERENCES "public"."users"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_consent" ADD CONSTRAINT "user_consent_user_pk_users_pk_fk" FOREIGN KEY ("user_pk") REFERENCES "public"."users"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_consent" ADD CONSTRAINT "user_consent_consent_fk" FOREIGN KEY ("consent_type","consent_version") REFERENCES "public"."consent"("type","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_oauth_account" ADD CONSTRAINT "user_oauth_account_user_pk_users_pk_fk" FOREIGN KEY ("user_pk") REFERENCES "public"."users"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coffee_chat_request_graduated_pk_index" ON "coffee_chat_request" USING btree ("graduated_pk");--> statement-breakpoint
CREATE INDEX "coffee_chat_request_student_pk_index" ON "coffee_chat_request" USING btree ("student_pk");--> statement-breakpoint
CREATE INDEX "notification_log_coffee_chat_request_pk_index" ON "notification_log" USING btree ("coffee_chat_request_pk");--> statement-breakpoint
CREATE INDEX "refresh_token_user_pk_index" ON "refresh_token" USING btree ("user_pk");--> statement-breakpoint
CREATE INDEX "student_profile_attachment_profile_pk_index" ON "student_profile_attachment" USING btree ("profile_pk");--> statement-breakpoint
CREATE INDEX "student_profile_department_pk_index" ON "student_profile" USING btree ("department_pk");--> statement-breakpoint
CREATE UNIQUE INDEX "user_consent_active_unique" ON "user_consent" USING btree ("user_pk","consent_type","consent_version") WHERE "user_consent"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "user_consent_user_pk_index" ON "user_consent" USING btree ("user_pk");--> statement-breakpoint
CREATE INDEX "users_pending_created_at_idx" ON "users" USING btree ("created_at") WHERE "users"."status" = 'pending';