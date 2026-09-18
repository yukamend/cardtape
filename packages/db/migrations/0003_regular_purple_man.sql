ALTER TABLE "tier_period" ADD COLUMN "source_id" text NOT NULL DEFAULT 'synthetic:tier-periods';--> statement-breakpoint
ALTER TABLE "tier_period" ADD COLUMN "provenance" text NOT NULL DEFAULT 'demo';--> statement-breakpoint
ALTER TABLE "tier_period" ALTER COLUMN "source_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tier_period" ALTER COLUMN "provenance" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tier_period" DROP CONSTRAINT "tier_period_program_id_card_account_valid_from_pk";--> statement-breakpoint
ALTER TABLE "tier_period" ADD CONSTRAINT "tier_period_program_id_card_account_valid_from_source_id_pk" PRIMARY KEY("program_id","card_account","valid_from","source_id");--> statement-breakpoint
ALTER TABLE "tier_period" DROP CONSTRAINT "tier_period_no_overlap";--> statement-breakpoint
ALTER TABLE "tier_period" ADD CONSTRAINT "tier_period_no_overlap" EXCLUDE USING gist (
	"program_id" WITH =,
	"card_account" WITH =,
	"source_id" WITH =,
	tstzrange("valid_from", COALESCE("valid_to", 'infinity'::timestamptz), '[)') WITH &&
);--> statement-breakpoint
CREATE INDEX "tier_period_source_current_idx" ON "tier_period" USING btree ("source_id","valid_to");--> statement-breakpoint
ALTER TABLE "tier_period" ADD CONSTRAINT "tier_period_provenance_check" CHECK ("tier_period"."provenance" IN ('measured', 'demo'));
UPDATE "spend_event" SET "card_account" = lower("card_account");--> statement-breakpoint
UPDATE "tier_event" SET "card_account" = lower("card_account");--> statement-breakpoint
UPDATE "tier_period" SET "card_account" = lower("card_account");
