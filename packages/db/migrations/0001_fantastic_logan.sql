CREATE INDEX "campaign_result_computed_at_idx" ON "campaign_result" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "market_price_symbol_time_idx" ON "market_price" USING btree ("symbol","observed_at");--> statement-breakpoint
CREATE INDEX "spend_event_program_time_idx" ON "spend_event" USING btree ("program_id","block_time");--> statement-breakpoint
CREATE INDEX "spend_event_account_time_idx" ON "spend_event" USING btree ("card_account","block_time");--> statement-breakpoint
CREATE INDEX "spend_event_source_block_idx" ON "spend_event" USING btree ("source_id","block_number");--> statement-breakpoint
CREATE INDEX "tier_event_program_time_idx" ON "tier_event" USING btree ("program_id","block_time");--> statement-breakpoint
CREATE INDEX "tier_event_account_time_idx" ON "tier_event" USING btree ("card_account","block_time");--> statement-breakpoint
CREATE INDEX "tier_period_account_interval_idx" ON "tier_period" USING btree ("program_id","card_account","valid_from","valid_to");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "tier_period" ADD CONSTRAINT "tier_period_no_overlap" EXCLUDE USING gist (
	"program_id" WITH =,
	"card_account" WITH =,
	tstzrange("valid_from", COALESCE("valid_to", 'infinity'::timestamptz), '[)') WITH &&
);
