CREATE TYPE "public"."integration_provider" AS ENUM('github', 'gitlab', 'linear');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('active', 'disconnected', 'error');--> statement-breakpoint
CREATE TABLE "realm_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realm_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"installation_id" text NOT NULL,
	"repo_full_name" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_token" text,
	"token_expires_at" timestamp with time zone,
	"status" "integration_status" DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "realm_integrations" ADD CONSTRAINT "realm_integrations_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "realm_integrations_realm_provider_uniq" ON "realm_integrations" USING btree ("realm_id","provider") WHERE "realm_integrations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "realm_integrations_realm_idx" ON "realm_integrations" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "realm_integrations_provider_install_idx" ON "realm_integrations" USING btree ("provider","installation_id");--> statement-breakpoint
CREATE INDEX "realm_integrations_realm_alive_idx" ON "realm_integrations" USING btree ("realm_id") WHERE "realm_integrations"."deleted_at" IS NULL;