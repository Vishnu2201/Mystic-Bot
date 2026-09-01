-- ============================================================
-- Hosting Nodes Infrastructure Source of Truth (Phase 1.6 Fix)
-- ============================================================

CREATE TABLE IF NOT EXISTS hosting_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(30) NOT NULL DEFAULT 'vps' CHECK (category IN ('vps', 'minecraft', 'both')),
    display_name VARCHAR(255) NOT NULL,
    country_code VARCHAR(10) NOT NULL DEFAULT 'DE',
    country_flag VARCHAR(10) NOT NULL DEFAULT '🇩🇪',
    location_name VARCHAR(255) NOT NULL DEFAULT 'Germany',
    node_name VARCHAR(255) NOT NULL DEFAULT 'DE-01',
    hostname VARCHAR(255) NOT NULL DEFAULT 'de-01.mysticservers.com',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_discord_id VARCHAR(32),
    updated_by_discord_id VARCHAR(32)
);

CREATE INDEX IF NOT EXISTS idx_hosting_nodes_active ON hosting_nodes(category, is_active, is_archived, display_order);

-- Seed confirmed production infrastructure node: Germany (DE-01)
INSERT INTO hosting_nodes (
    category, display_name, country_code, country_flag, location_name, node_name, hostname, is_active, is_archived, display_order
)
VALUES (
    'both',
    'Germany — DE-01',
    'DE',
    '🇩🇪',
    'Germany',
    'DE-01',
    'de-01.mysticservers.com',
    TRUE,
    FALSE,
    1
)
ON CONFLICT DO NOTHING;

-- Add nullable hosting_node_id foreign key references
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vps_instances' AND column_name = 'hosting_node_id'
  ) THEN
    ALTER TABLE vps_instances ADD COLUMN hosting_node_id UUID REFERENCES hosting_nodes(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'minecraft_servers' AND column_name = 'hosting_node_id'
  ) THEN
    ALTER TABLE minecraft_servers ADD COLUMN hosting_node_id UUID REFERENCES hosting_nodes(id);
  END IF;
END $$;
