-- The audit log is append-only. Row edits and deletions are rejected by the database itself;
-- the per-organization hash chain additionally detects out-of-band tampering (e.g. TRUNCATE by a DBA).
CREATE OR REPLACE FUNCTION stele_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION stele_audit_log_immutable();
