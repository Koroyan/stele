CREATE TABLE "gate_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"address" text NOT NULL,
	"required_version" integer NOT NULL,
	"required_version_hash" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gate_policies_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "gate_policies_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "access_passes" ADD COLUMN "version_hash" text;--> statement-breakpoint
ALTER TABLE "gate_policies" ADD CONSTRAINT "gate_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_policies" ADD CONSTRAINT "gate_policies_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;