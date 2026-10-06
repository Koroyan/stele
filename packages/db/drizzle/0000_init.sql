CREATE TYPE "public"."acceptance_commitment" AS ENUM('confirmed', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'api_key', 'system');--> statement-breakpoint
CREATE TYPE "public"."challenge_status" AS ENUM('issued', 'submitted', 'confirmed', 'finalized', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'delivered', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'verified', 'failed', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('draft', 'prepared', 'published', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."shard_status" AS ENUM('active', 'full', 'retired');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "acceptance_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_address" text NOT NULL,
	"shard_row_id" uuid NOT NULL,
	"nonce_index" integer NOT NULL,
	"nonce_tag" text NOT NULL,
	"signer_address" text NOT NULL,
	"request_domain" text NOT NULL,
	"issued_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"message" text NOT NULL,
	"status" "challenge_status" DEFAULT 'issued' NOT NULL,
	"client_binding_hash" text NOT NULL,
	"acceptance_session_id" uuid,
	"external_user_ref" text,
	"tx_signature" text,
	"acceptance_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acceptance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid,
	"token_hash" text NOT NULL,
	"external_user_ref" text,
	"created_by_api_key_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acceptance_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "acceptances" (
	"acceptance_id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_address" text NOT NULL,
	"version_number" integer NOT NULL,
	"signer_address" text NOT NULL,
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
	"challenge_id" uuid,
	"external_user_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acceptances_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"sequence" integer NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tx_signature" text,
	"ip_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"entry_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "auth_challenges_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "content_objects" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"byte_size" integer NOT NULL,
	"cid" text NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"title" text NOT NULL,
	"version_label" text NOT NULL,
	"effective_at" bigint,
	"source" text NOT NULL,
	"change_summary" text,
	"status" "draft_status" DEFAULT 'draft' NOT NULL,
	"prepared_version_number" integer,
	"prepared_content_hash" text,
	"prepared_version_hash" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"address" text NOT NULL,
	"number" integer NOT NULL,
	"version_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"previous_version_hash" text,
	"title" text NOT NULL,
	"version_label" text NOT NULL,
	"effective_at" bigint,
	"published_at" timestamp with time zone NOT NULL,
	"published_slot" bigint NOT NULL,
	"publisher_address" text NOT NULL,
	"publisher_role" integer NOT NULL,
	"storage_uri" text NOT NULL,
	"publish_tx" text,
	"finalized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_address_unique" UNIQUE("address"),
	CONSTRAINT "document_versions_version_hash_unique" UNIQUE("version_hash")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"address" text NOT NULL,
	"slug" text NOT NULL,
	"document_type" text NOT NULL,
	"locale" text NOT NULL,
	"version_count" integer DEFAULT 0 NOT NULL,
	"head_hash" text,
	"current_version_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "domain_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"txt_name" text NOT NULL,
	"txt_value" text NOT NULL,
	"requested_by" uuid,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"attestation_tx" text,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_signature" text,
	"last_slot" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nonce_shards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"address" text NOT NULL,
	"shard_id" integer NOT NULL,
	"relayer_address" text NOT NULL,
	"next_index" integer DEFAULT 0 NOT NULL,
	"status" "shard_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nonce_shards_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_address" text NOT NULL,
	"roles" integer NOT NULL,
	"active" boolean NOT NULL,
	"compromised_since" timestamp with time zone,
	"label" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"creator_address" text NOT NULL,
	"name" text NOT NULL,
	"owner_address" text NOT NULL,
	"recovery_address" text,
	"verified_domain" text,
	"domain_verified_at" timestamp with time zone,
	"domain_expires_at" timestamp with time zone,
	"frozen" boolean DEFAULT false NOT NULL,
	"frozen_by" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chain_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reauthenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_hash" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"display_name" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_response_status" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"events" text[] NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"status" "webhook_status" DEFAULT 'active' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acceptance_challenges" ADD CONSTRAINT "acceptance_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_challenges" ADD CONSTRAINT "acceptance_challenges_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_challenges" ADD CONSTRAINT "acceptance_challenges_shard_row_id_nonce_shards_id_fk" FOREIGN KEY ("shard_row_id") REFERENCES "public"."nonce_shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_challenges" ADD CONSTRAINT "acceptance_challenges_acceptance_session_id_acceptance_sessions_id_fk" FOREIGN KEY ("acceptance_session_id") REFERENCES "public"."acceptance_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_sessions" ADD CONSTRAINT "acceptance_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_sessions" ADD CONSTRAINT "acceptance_sessions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_challenge_id_acceptance_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."acceptance_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_verifications" ADD CONSTRAINT "domain_verifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_verifications" ADD CONSTRAINT "domain_verifications_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonce_shards" ADD CONSTRAINT "nonce_shards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "challenges_shard_nonce_unique" ON "acceptance_challenges" USING btree ("shard_row_id","nonce_index");--> statement-breakpoint
CREATE INDEX "challenges_status_idx" ON "acceptance_challenges" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "acceptance_sessions_org_idx" ON "acceptance_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "acceptances_org_time_idx" ON "acceptances" USING btree ("organization_id","block_time");--> statement-breakpoint
CREATE INDEX "acceptances_version_idx" ON "acceptances" USING btree ("version_address");--> statement-breakpoint
CREATE INDEX "acceptances_signer_idx" ON "acceptances" USING btree ("signer_address");--> statement-breakpoint
CREATE INDEX "acceptances_external_ref_idx" ON "acceptances" USING btree ("organization_id","external_user_ref");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_org_sequence_unique" ON "audit_log" USING btree ("organization_id","sequence");--> statement-breakpoint
CREATE INDEX "audit_org_time_idx" ON "audit_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "drafts_document_idx" ON "document_drafts" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_document_number_unique" ON "document_versions" USING btree ("document_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_org_slug_unique" ON "documents" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "domain_verifications_org_idx" ON "domain_verifications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "domain_verifications_domain_idx" ON "domain_verifications" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "shards_org_shard_unique" ON "nonce_shards" USING btree ("organization_id","shard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_unique" ON "organization_members" USING btree ("organization_id","member_address");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_endpoint_event_unique" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "webhooks_org_idx" ON "webhook_endpoints" USING btree ("organization_id");