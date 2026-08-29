ALTER TABLE "realms" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "currents_realm_doc_idx" ON "currents" USING btree ("realm_id","doc_ref");--> statement-breakpoint
CREATE INDEX "entities_realm_idx" ON "entities" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "realms_created_idx" ON "realms" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "threads_realm_alive_idx" ON "threads" USING btree ("realm_id","created_at") WHERE "threads"."deleted_at" IS NULL;