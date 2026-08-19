-- Run this migration if vps_instances already exists.
-- Existing VPS records are given a starting one-month term from their original creation time.

ALTER TABLE vps_instances
  ADD COLUMN IF NOT EXISTS billing_cycle_months INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_count INTEGER NOT NULL DEFAULT 0;

UPDATE vps_instances
SET
  provisioned_at = COALESCE(provisioned_at, created_at, NOW()),
  expires_at = COALESCE(
    expires_at,
    COALESCE(provisioned_at, created_at, NOW()) + INTERVAL '1 month'
  )
WHERE provisioned_at IS NULL OR expires_at IS NULL;

ALTER TABLE vps_instances
  ALTER COLUMN provisioned_at SET DEFAULT NOW(),
  ALTER COLUMN provisioned_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '1 month'),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vps_instances_expires_at
  ON vps_instances(expires_at);

CREATE TABLE IF NOT EXISTS vps_renewals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE RESTRICT,
  billing_cycle_months INTEGER NOT NULL,
  amount_inr NUMERIC(10,2) NOT NULL,
  amount_usd NUMERIC(10,2) NOT NULL,
  previous_expiry TIMESTAMPTZ NOT NULL,
  new_expiry TIMESTAMPTZ NOT NULL,
  renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renewed_by_discord_id VARCHAR(32) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vps_renewals_vps_id
  ON vps_renewals(vps_id);

CREATE TABLE IF NOT EXISTS vps_expiry_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
  expiry_date DATE NOT NULL,
  notice_type VARCHAR(30) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(vps_id, expiry_date, notice_type)
);
