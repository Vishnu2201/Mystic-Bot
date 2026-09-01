-- Migration: Add customer VPS sequence counter and instance naming support
-- Safe and idempotent for existing production database.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS vps_sequence_counter INTEGER NOT NULL DEFAULT 0;

ALTER TABLE vps_instances
  ADD COLUMN IF NOT EXISTS customer_vps_sequence INTEGER,
  ADD COLUMN IF NOT EXISTS instance_name VARCHAR(255);

-- Initialize vps_sequence_counter for existing customers safely and idempotently
UPDATE customers c
SET vps_sequence_counter = GREATEST(
  COALESCE(c.vps_sequence_counter, 0),
  COALESCE((
    SELECT COUNT(*)
    FROM vps_instances v
    WHERE v.customer_id = c.id
  ), 0),
  COALESCE((
    SELECT MAX(v.customer_vps_sequence)
    FROM vps_instances v
    WHERE v.customer_id = c.id
  ), 0)
);

-- Backfill instance_name for existing VPS instances to match their provider_instance_id
UPDATE vps_instances
SET instance_name = provider_instance_id
WHERE instance_name IS NULL;

-- Enforce uniqueness for per-customer sequence numbers on new instances
CREATE UNIQUE INDEX IF NOT EXISTS idx_vps_instances_customer_sequence
  ON vps_instances(customer_id, customer_vps_sequence)
  WHERE customer_vps_sequence IS NOT NULL;
