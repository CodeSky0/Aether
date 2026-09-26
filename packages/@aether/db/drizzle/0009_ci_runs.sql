CREATE TYPE "public"."ci_status" AS ENUM('queued', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."ci_conclusion" AS ENUM('success', 'failure', 'neutral', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TABLE "ci_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realm_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"head_sha" text NOT NULL,
	"name" text NOT NULL,
	"status" "ci_status" DEFAULT 'queued' NOT NULL,
	"conclusion" "ci_conclusion",
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"html_url" text,
	"details_url" text,
	"pr_number" integer
);--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ci_runs_realm_idx" ON "ci_runs" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "ci_runs_sha_idx" ON "ci_runs" USING btree ("realm_id","head_sha");--> statement-breakpoint
CREATE INDEX "ci_runs_pr_idx" ON "ci_runs" USING btree ("realm_id","pr_number");
