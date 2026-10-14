ALTER TABLE "access_passes" DROP CONSTRAINT "access_passes_address_unique";--> statement-breakpoint
ALTER TABLE "access_passes" ADD COLUMN "storage" text DEFAULT 'pass' NOT NULL;--> statement-breakpoint
ALTER TABLE "access_passes" ADD COLUMN "deposit_payer" text;