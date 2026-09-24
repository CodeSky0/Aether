CREATE TYPE "public"."ai_provider" AS ENUM('openai', 'anthropic', 'google', 'azure-openai', 'custom');--> statement-breakpoint
CREATE TYPE "public"."join_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "realm_ai_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realm_id" uuid NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"label" text,
	"api_key_encrypted" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realm_join_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realm_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "realm_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realm_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"join_code" text NOT NULL,
	"requested_role" text DEFAULT 'member' NOT NULL,
	"status" "join_request_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_ai_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"label" text,
	"api_key_encrypted" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "realm_ai_configs" ADD CONSTRAINT "realm_ai_configs_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_join_codes" ADD CONSTRAINT "realm_join_codes_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_join_requests" ADD CONSTRAINT "realm_join_requests_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realm_ai_configs_realm_idx" ON "realm_ai_configs" USING btree ("realm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "realm_ai_configs_realm_default_uniq" ON "realm_ai_configs" USING btree ("realm_id") WHERE "realm_ai_configs"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "realm_join_codes_realm_active_uniq" ON "realm_join_codes" USING btree ("realm_id") WHERE "realm_join_codes"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "realm_join_codes_code_uniq" ON "realm_join_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "realm_join_requests_realm_status_idx" ON "realm_join_requests" USING btree ("realm_id","status");--> statement-breakpoint
CREATE INDEX "realm_join_requests_user_idx" ON "realm_join_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "realm_join_requests_realm_user_pending_uniq" ON "realm_join_requests" USING btree ("realm_id","user_id") WHERE "realm_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "user_ai_configs_user_idx" ON "user_ai_configs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_ai_configs_user_default_uniq" ON "user_ai_configs" USING btree ("user_id") WHERE "user_ai_configs"."is_default";