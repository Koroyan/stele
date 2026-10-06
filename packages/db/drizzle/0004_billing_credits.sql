CREATE TABLE "billing_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pack" text NOT NULL,
	"credits" integer NOT NULL,
	"lamports" bigint NOT NULL,
	"treasury" text NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"tx_signature" text,
	"payer" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "billing_invoices_reference_unique" UNIQUE("reference"),
	CONSTRAINT "billing_invoices_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_invoices_org_time_idx" ON "billing_invoices" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_kind_reference_idx" ON "credit_ledger" USING btree ("kind","reference");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_idx" ON "credit_ledger" USING btree ("organization_id");