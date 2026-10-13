ALTER TABLE "acceptance_challenges" ADD COLUMN "signer_ip_ciphertext" text;--> statement-breakpoint
ALTER TABLE "acceptance_challenges" ADD COLUMN "signer_time_zone" text;--> statement-breakpoint
ALTER TABLE "acceptance_challenges" ADD COLUMN "signer_utc_offset_minutes" integer;