-- Migration: VPS Lifecycle Hardening (Persistent Private IP, Public SSH Gateway & Storage Quota state)
-- Idempotent & non-destructive migration script for production PostgreSQL.

ALTER TABLE vps_instances
  ADD COLUMN IF NOT EXISTS public_ssh_host VARCHAR(255) NOT NULL DEFAULT 'ssh.mysticservers.com',
  ADD COLUMN IF NOT EXISTS public_ssh_port INTEGER,
  ADD COLUMN IF NOT EXISTS public_ssh_target_host VARCHAR(50),
  ADD COLUMN IF NOT EXISTS public_ssh_target_port INTEGER DEFAULT 22,
  ADD COLUMN IF NOT EXISTS public_ssh_status VARCHAR(30) NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS public_ssh_last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS storage_limit_requested INTEGER,
  ADD COLUMN IF NOT EXISTS storage_limit_enforced BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storage_backend VARCHAR(50) NOT NULL DEFAULT 'directory',
  ADD COLUMN IF NOT EXISTS storage_status VARCHAR(100) NOT NULL DEFAULT 'unbounded_directory';

-- Unique partial index enforcing that no two active/non-deleted VPS instances share a public SSH port
CREATE UNIQUE INDEX IF NOT EXISTS idx_vps_instances_active_public_ssh_port
  ON vps_instances(public_ssh_port)
  WHERE status != 'deleted' AND public_ssh_port IS NOT NULL;

-- Unique partial index enforcing that no two active/non-deleted VPS instances share a private IPv4 address
CREATE UNIQUE INDEX IF NOT EXISTS idx_vps_instances_active_private_ipv4
  ON vps_instances(private_ipv4)
  WHERE status != 'deleted' AND private_ipv4 IS NOT NULL;

-- Safe conversion ensuring private_ipv4 column is INET type across environments
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vps_instances' AND column_name = 'private_ipv4' AND (data_type LIKE '%char%' OR data_type LIKE '%text%')
  ) THEN
    ALTER TABLE vps_instances ALTER COLUMN private_ipv4 TYPE INET USING private_ipv4::inet;
  END IF;
END $$;
