CREATE TABLE "student_email_send_log" (
	"pk" uuid PRIMARY KEY NOT NULL,
	"user_pk" uuid NOT NULL,
	"failed_attempt_count" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" varchar(255) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_email_send_log" ADD CONSTRAINT "student_email_send_log_user_pk_users_pk_fk" FOREIGN KEY ("user_pk") REFERENCES "public"."users"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_email_send_log_user_pk_created_at_index" ON "student_email_send_log" USING btree ("user_pk","created_at");--> statement-breakpoint
CREATE INDEX "student_email_send_log_email_created_at_index" ON "student_email_send_log" USING btree ("email","created_at");