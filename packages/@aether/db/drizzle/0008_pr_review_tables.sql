CREATE TYPE "public"."pr_state" AS ENUM('open', 'closed', 'merged', 'draft');--> statement-breakpoint
CREATE TYPE "public"."pr_review_state" AS ENUM('approved', 'changes_requested', 'commented', 'dismissed');--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realm_id" uuid NOT NULL,
	"thread_id" uuid,
	"number" integer NOT NULL,
	"repo_full_name" text NOT NULL,
	"head_sha" text NOT NULL,
	"base_sha" text NOT NULL,
	"state" "pr_state" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "pr_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pr_id" uuid NOT NULL,
	"review_id" integer NOT NULL,
	"state" "pr_review_state" NOT NULL,
	"body" text,
	"reviewer" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "pr_review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pr_id" uuid NOT NULL,
	"review_id" uuid,
	"path" text NOT NULL,
	"line" integer,
	"side" text,
	"in_reply_to_id" uuid,
	"body" text NOT NULL,
	"author" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_reviews" ADD CONSTRAINT "pr_reviews_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_review_comments" ADD CONSTRAINT "pr_review_comments_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_review_comments" ADD CONSTRAINT "pr_review_comments_review_id_pr_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."pr_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_requests_realm_idx" ON "pull_requests" USING btree ("realm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_realm_number_uniq" ON "pull_requests" USING btree ("realm_id","number");--> statement-breakpoint
CREATE INDEX "pr_reviews_pr_idx" ON "pr_reviews" USING btree ("pr_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_reviews_review_id_uniq" ON "pr_reviews" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "pr_review_comments_pr_idx" ON "pr_review_comments" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "pr_review_comments_path_idx" ON "pr_review_comments" USING btree ("pr_id","path");
