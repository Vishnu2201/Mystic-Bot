-- Migration: Add Public SSH Gateway Host and Port to vps_instances
-- Safe and idempotent migration for production database.

ALTER TABLE vps_instances
  ADD COLUMN IF NOT EXISTS public_ssh_host VARCHAR(255) NOT NULL DEFAULT 'ssh.mysticservers.com',
  ADD COLUMN IF NOT EXISTS public_ssh_port INTEGER;

-- Unique partial index enforcing that no two non-deleted VPS instances share a public SSH port
CREATE UNIQUE INDEX IF NOT EXISTS idx_vps_instances_active_public_ssh_port
  ON vps_instances(public_ssh_port)
  WHERE status != 'deleted' AND public_ssh_port IS NOT NULL;
