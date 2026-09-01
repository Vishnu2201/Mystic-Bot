-- ============================================================
-- Fix Pricing Audit Logs Entity Type Check Constraint
-- ============================================================

DO $$
BEGIN
  -- Drop existing entity_type check constraint if present
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pricing_audit_logs_entity_type_check'
  ) THEN
    ALTER TABLE pricing_audit_logs DROP CONSTRAINT pricing_audit_logs_entity_type_check;
  END IF;

  -- Add updated check constraint supporting all application audit entity types
  ALTER TABLE pricing_audit_logs
    ADD CONSTRAINT pricing_audit_logs_entity_type_check
    CHECK (entity_type IN ('plan', 'billing', 'ipv4', 'node', 'display'));
END $$;
