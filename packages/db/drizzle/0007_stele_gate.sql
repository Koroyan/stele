CREATE TABLE "access_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"address" text NOT NULL,
	"holder" text NOT NULL,
	"version_address" text NOT NULL,
	"version_number" integer NOT NULL,
	"acceptance_id" text NOT NULL,
	"acceptance_count" integer NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"first_accepted_at" timestamp with time zone NOT NULL,
	"slot" bigint NOT NULL,
	"tx_signature" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_passes_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "demo_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"document_id" uuid NOT NULL,
	"market_address" text,
	"ip_hash" text NOT NULL,
	"publish_count" integer DEFAULT 1 NOT NULL,
	"action_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "demo_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "gate_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_address" text NOT NULL,
	"label" text NOT NULL,
	"action" text NOT NULL,
	"policy_document_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "gated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "access_passes" ADD CONSTRAINT "access_passes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_passes" ADD CONSTRAINT "access_passes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_sessions" ADD CONSTRAINT "demo_sessions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_programs" ADD CONSTRAINT "gate_programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_programs" ADD CONSTRAINT "gate_programs_policy_document_id_documents_id_fk" FOREIGN KEY ("policy_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_passes_document_idx" ON "access_passes" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_passes_document_holder_unique" ON "access_passes" USING btree ("document_id","holder");--> statement-breakpoint
CREATE INDEX "demo_sessions_ip_idx" ON "demo_sessions" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_programs_org_program_unique" ON "gate_programs" USING btree ("organization_id","program_address");