ALTER TABLE "tier_event" ADD COLUMN "source_id" text DEFAULT 'synthetic:tier' NOT NULL;--> statement-breakpoint
ALTER TABLE "tier_event" ALTER COLUMN "source_id" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "tier_event_source_block_idx" ON "tier_event" USING btree ("source_id","block_number");
