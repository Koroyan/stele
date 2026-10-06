ALTER TYPE "public"."signer_identity_status" ADD VALUE 'pending';--> statement-breakpoint
ALTER TABLE "passkey_credentials" ALTER COLUMN "prf_salt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ALTER COLUMN "wrapped_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ALTER COLUMN "key_statement" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ALTER COLUMN "key_signature" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ALTER COLUMN "statement_assertion" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "signed_message" text;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "signer_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "enrollment_address" text;--> statement-breakpoint
ALTER TABLE "passkey_challenges" ADD COLUMN "statement" text;--> statement-breakpoint
ALTER TABLE "passkey_challenges" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "signer_identities" ADD COLUMN "algorithm" text DEFAULT 'ed25519-prf' NOT NULL;--> statement-breakpoint
ALTER TABLE "signer_identities" ADD COLUMN "account_salt" text;--> statement-breakpoint
ALTER TABLE "signer_identities" ADD COLUMN "account_commitment" text;--> statement-breakpoint
ALTER TABLE "signer_identities" ADD COLUMN "enrollment_address" text;--> statement-breakpoint
ALTER TABLE "signer_identities" ADD COLUMN "enrollment_evidence" jsonb;--> statement-breakpoint
CREATE INDEX "signer_identities_enrollment_idx" ON "signer_identities" USING btree ("enrollment_address");