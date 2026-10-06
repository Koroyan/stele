CREATE TYPE "public"."signer_identity_status" AS ENUM('active', 'rotated', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."proof_request_status" AS ENUM('open', 'issued', 'submitted', 'confirmed', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "passkey_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"challenge" text NOT NULL,
	"rp_id" text NOT NULL,
	"external_user_ref" text,
	"acceptance_session_id" uuid,
	"identity_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"algorithm" integer NOT NULL,
	"rp_id" text NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"prf_salt" text NOT NULL,
	"wrapped_key" jsonb NOT NULL,
	"key_statement" text NOT NULL,
	"key_signature" text NOT NULL,
	"statement_assertion" jsonb NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "proof_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_token_hash" text NOT NULL,
	"proof_type" text NOT NULL,
	"statement" jsonb NOT NULL,
	"statement_hash" text NOT NULL,
	"reference" text NOT NULL,
	"external_user_ref" text,
	"created_by_api_key_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "proof_request_status" DEFAULT 'open' NOT NULL,
	"shard_row_id" uuid,
	"nonce_index" integer,
	"nonce_tag" text,
	"signer_address" text,
	"signer_type" text,
	"signer_identity_id" uuid,
	"request_domain" text,
	"issued_at" bigint,
	"challenge_expires_at" bigint,
	"message" text,
	"client_binding_hash" text,
	"passkey_assertion" jsonb,
	"tx_signature" text,
	"proof_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proofs" (
	"proof_id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"proof_type" text NOT NULL,
	"statement_hash" text NOT NULL,
	"reference" text,
	"signer_address" text NOT NULL,
	"signer_type" text DEFAULT 'wallet' NOT NULL,
	"tx_signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" timestamp with time zone,
	"issued_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"nonce_shard_address" text NOT NULL,
	"nonce_index" integer NOT NULL,
	"message_hash" text NOT NULL,
	"request_domain" text NOT NULL,
	"commitment" "acceptance_commitment" DEFAULT 'confirmed' NOT NULL,
	"proof_request_id" uuid,
	"external_user_ref" text,
	"fee_payer" text,
	"fee_lamports" bigint,
	"reimbursed_lamports" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"kit_id" text NOT NULL,
	"wrapped_key" jsonb NOT NULL,
	"key_statement" text NOT NULL,
	"key_signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "recovery_kits_kit_id_unique" UNIQUE("kit_id")
);
--> statement-breakpoint
CREATE TABLE "signer_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"rp_id" text NOT NULL,
	"external_user_ref" text,
	"status" "signer_identity_status" DEFAULT 'active' NOT NULL,
	"rotated_from_id" uuid,
	"rotation_kind" text,
	"rotation_statement" text,
	"rotation_previous_signature" text,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone,
	CONSTRAINT "signer_identities_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE "sponsored_transactions" (
	"tx_signature" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"record_kind" text NOT NULL,
	"record_id" text NOT NULL,
	"fee_payer" text NOT NULL,
	"fee_lamports" bigint NOT NULL,
	"sponsor" text NOT NULL,
	"reimbursed_lamports" bigint DEFAULT 0 NOT NULL,
	"nonce_shard_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acceptance_challenges" ADD COLUMN "signer_type" text DEFAULT 'wallet' NOT NULL;--> statement-breakpoint
ALTER TABLE "acceptance_challenges" ADD COLUMN "signer_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "acceptance_challenges" ADD COLUMN "passkey_assertion" jsonb;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "signer_type" text DEFAULT 'wallet' NOT NULL;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "fee_payer" text;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "fee_lamports" bigint;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "reimbursed_lamports" bigint;--> statement-breakpoint
ALTER TABLE "nonce_shards" ADD COLUMN "sponsorship" jsonb;--> statement-breakpoint
ALTER TABLE "nonce_shards" ADD COLUMN "sponsorship_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "passkey_challenges" ADD CONSTRAINT "passkey_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_identity_id_signer_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."signer_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_requests" ADD CONSTRAINT "proof_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_requests" ADD CONSTRAINT "proof_requests_shard_row_id_nonce_shards_id_fk" FOREIGN KEY ("shard_row_id") REFERENCES "public"."nonce_shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_proof_request_id_proof_requests_id_fk" FOREIGN KEY ("proof_request_id") REFERENCES "public"."proof_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_kits" ADD CONSTRAINT "recovery_kits_identity_id_signer_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."signer_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signer_identities" ADD CONSTRAINT "signer_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsored_transactions" ADD CONSTRAINT "sponsored_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_credentials_identity_idx" ON "passkey_credentials" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "proof_requests_org_idx" ON "proof_requests" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "proof_requests_reference_idx" ON "proof_requests" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "proofs_org_time_idx" ON "proofs" USING btree ("organization_id","block_time");--> statement-breakpoint
CREATE INDEX "proofs_reference_idx" ON "proofs" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "proofs_signer_idx" ON "proofs" USING btree ("signer_address");--> statement-breakpoint
CREATE INDEX "recovery_kits_identity_idx" ON "recovery_kits" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "signer_identities_org_idx" ON "signer_identities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "signer_identities_account_idx" ON "signer_identities" USING btree ("organization_id","external_user_ref");--> statement-breakpoint
CREATE INDEX "sponsored_tx_org_time_idx" ON "sponsored_transactions" USING btree ("organization_id","created_at");