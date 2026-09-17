CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"name" text NOT NULL,
	"source_url" text NOT NULL,
	"announced_at" timestamp with time zone,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"payout_at" timestamp with time zone,
	"mechanic" text NOT NULL,
	"eligible_tiers" text[] NOT NULL,
	"control_tiers" text[] NOT NULL,
	"region" text,
	"stated_budget_usd" numeric(20, 4),
	"signature" jsonb NOT NULL,
	"method_note" text NOT NULL,
	CONSTRAINT "campaign_date_order" CHECK ("campaign"."ends_at" > "campaign"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "campaign_result" (
	"campaign_id" text NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(20, 4),
	"ci_low" numeric(20, 4),
	"ci_high" numeric(20, 4),
	"provenance" text NOT NULL,
	"method_note" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "campaign_result_campaign_id_metric_pk" PRIMARY KEY("campaign_id","metric"),
	CONSTRAINT "campaign_result_provenance_check" CHECK ("campaign_result"."provenance" IN ('measured', 'inferred', 'estimated', 'demo')),
	CONSTRAINT "campaign_result_ci_order" CHECK ("campaign_result"."ci_low" IS NULL OR "campaign_result"."ci_high" IS NULL OR "campaign_result"."ci_high" >= "campaign_result"."ci_low")
);
--> statement-breakpoint
CREATE TABLE "ingest_cursor" (
	"source_id" text PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_price" (
	"source_id" text NOT NULL,
	"symbol" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"price_usd" numeric(30, 10) NOT NULL,
	"volume_usd" numeric(30, 4) NOT NULL,
	"provenance" text NOT NULL,
	CONSTRAINT "market_price_source_id_symbol_observed_at_pk" PRIMARY KEY("source_id","symbol","observed_at"),
	CONSTRAINT "market_price_positive" CHECK ("market_price"."price_usd" > 0 AND "market_price"."volume_usd" >= 0),
	CONSTRAINT "market_price_provenance_check" CHECK ("market_price"."provenance" IN ('measured', 'demo'))
);
--> statement-breakpoint
CREATE TABLE "spend_event" (
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"event_type" text NOT NULL,
	"program_id" text NOT NULL,
	"card_account" text NOT NULL,
	"token_symbol" text NOT NULL,
	"decimals" integer NOT NULL,
	"amount_raw" numeric(78, 0) NOT NULL,
	"settlement_ccy" text NOT NULL,
	"amount_usd" numeric(20, 4),
	"price_source" text,
	"priced_at" timestamp with time zone,
	"source_id" text NOT NULL,
	"provenance" text NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	CONSTRAINT "spend_event_chain_id_tx_hash_log_index_pk" PRIMARY KEY("chain_id","tx_hash","log_index"),
	CONSTRAINT "spend_event_amount_raw_nonnegative" CHECK ("spend_event"."amount_raw" >= 0),
	CONSTRAINT "spend_event_decimals_range" CHECK ("spend_event"."decimals" BETWEEN 0 AND 36),
	CONSTRAINT "spend_event_provenance_check" CHECK ("spend_event"."provenance" IN ('measured', 'demo')),
	CONSTRAINT "spend_event_currency_check" CHECK ("spend_event"."settlement_ccy" IN ('USD', 'EUR', 'GBP')),
	CONSTRAINT "spend_event_type_check" CHECK ("spend_event"."event_type" IN ('spend', 'top_up', 'cashback', 'settlement'))
);
--> statement-breakpoint
CREATE TABLE "tier_event" (
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"program_id" text NOT NULL,
	"card_account" text NOT NULL,
	"action" text NOT NULL,
	"asset" text NOT NULL,
	"amount_raw" numeric(78, 0) NOT NULL,
	"provenance" text NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tier_event_chain_id_tx_hash_log_index_pk" PRIMARY KEY("chain_id","tx_hash","log_index"),
	CONSTRAINT "tier_event_amount_raw_nonnegative" CHECK ("tier_event"."amount_raw" >= 0),
	CONSTRAINT "tier_event_action_check" CHECK ("tier_event"."action" IN ('stake', 'unstake', 'deposit', 'withdraw')),
	CONSTRAINT "tier_event_asset_check" CHECK ("tier_event"."asset" IN ('ETHFI', 'LIQUID')),
	CONSTRAINT "tier_event_provenance_check" CHECK ("tier_event"."provenance" IN ('measured', 'demo'))
);
--> statement-breakpoint
CREATE TABLE "tier_period" (
	"program_id" text NOT NULL,
	"card_account" text NOT NULL,
	"tier" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"qualified_by" text NOT NULL,
	CONSTRAINT "tier_period_program_id_card_account_valid_from_pk" PRIMARY KEY("program_id","card_account","valid_from"),
	CONSTRAINT "tier_period_date_order" CHECK ("tier_period"."valid_to" IS NULL OR "tier_period"."valid_to" > "tier_period"."valid_from"),
	CONSTRAINT "tier_period_tier_check" CHECK ("tier_period"."tier" IN ('core', 'luxe', 'pinnacle', 'vip')),
	CONSTRAINT "tier_period_qualification_check" CHECK ("tier_period"."qualified_by" IN ('sethfi', 'liquid', 'points', 'paid', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "campaign_result" ADD CONSTRAINT "campaign_result_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;