CREATE TABLE "oauth_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realm_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"client_secret_hash" text NOT NULL,
	"client_secret_prefix" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"realm_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	"code_challenge" text,
	"code_challenge_method" text,
	"exchanged_at" timestamp with time zone,
	"token_hash" text,
	"token_prefix" text,
	"token_issued_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD CONSTRAINT "oauth_apps_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorizations" ADD CONSTRAINT "oauth_authorizations_app_id_oauth_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."oauth_apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorizations" ADD CONSTRAINT "oauth_authorizations_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_apps_client_id_uniq" ON "oauth_apps" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_apps_realm_idx" ON "oauth_apps" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "oauth_apps_realm_alive_idx" ON "oauth_apps" USING btree ("realm_id") WHERE "oauth_apps"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_authorizations_token_hash_uniq" ON "oauth_authorizations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "oauth_authorizations_app_user_idx" ON "oauth_authorizations" USING btree ("app_id","user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "oauth_authorizations_user_idx" ON "oauth_authorizations" USING btree ("user_id","revoked_at");