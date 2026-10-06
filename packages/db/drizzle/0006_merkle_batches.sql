CREATE TABLE "acceptance_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"shard_row_id" uuid NOT NULL,
	"root" text NOT NULL,
	"leaf_count" integer NOT NULL,
	"status" text DEFAULT 'anchoring' NOT NULL,
	"onchain_batch_id" text,
	"tx_signature" text,
	"slot" bigint,
	"manifest_hash" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anchored_at" timestamp with time zone,
	CONSTRAINT "acceptance_batches_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE "batch_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"challenge_id" uuid,
	"shard_row_id" uuid NOT NULL,
	"acceptance_id" text NOT NULL,
	"leaf_hash" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"batch_id" uuid,
	"leaf_index" integer,
	"expires_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_leaves_acceptance_id_unique" UNIQUE("acceptance_id")
);
--> statement-breakpoint
ALTER TABLE "acceptances" DROP CONSTRAINT "acceptances_tx_signature_unique";--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "evidence_mode" text DEFAULT 'DIRECT_ONCHAIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "leaf_index" integer;--> statement-breakpoint
ALTER TABLE "sponsored_transactions" ADD COLUMN "record_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "acceptance_batches" ADD CONSTRAINT "acceptance_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_batches" ADD CONSTRAINT "acceptance_batches_shard_row_id_nonce_shards_id_fk" FOREIGN KEY ("shard_row_id") REFERENCES "public"."nonce_shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_leaves" ADD CONSTRAINT "batch_leaves_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_leaves" ADD CONSTRAINT "batch_leaves_challenge_id_acceptance_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."acceptance_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_leaves" ADD CONSTRAINT "batch_leaves_shard_row_id_nonce_shards_id_fk" FOREIGN KEY ("shard_row_id") REFERENCES "public"."nonce_shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_leaves" ADD CONSTRAINT "batch_leaves_batch_id_acceptance_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."acceptance_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acceptance_batches_org_idx" ON "acceptance_batches" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "batch_leaves_pending_idx" ON "batch_leaves" USING btree ("status","shard_row_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "acceptances_direct_tx_unique" ON "acceptances" USING btree ("tx_signature") WHERE evidence_mode = 'DIRECT_ONCHAIN';--> statement-breakpoint
CREATE INDEX "acceptances_tx_idx" ON "acceptances" USING btree ("tx_signature");