-- ============================================================
-- Unified Catalog Migration for VPS, Minecraft, IPv4 & Billing
-- ============================================================

-- 1. Upgrade pricing_plans table with category, lifecycle, and ordering
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pricing_plans' AND column_name = 'category'
  ) THEN
    ALTER TABLE pricing_plans ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'vps';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pricing_plans' AND column_name = 'description'
  ) THEN
    ALTER TABLE pricing_plans ADD COLUMN description TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pricing_plans' AND column_name = 'is_archived'
  ) THEN
    ALTER TABLE pricing_plans ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pricing_plans' AND column_name = 'display_order'
  ) THEN
    ALTER TABLE pricing_plans ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pricing_plans' AND column_name = 'memory_mb'
  ) THEN
    ALTER TABLE pricing_plans ADD COLUMN memory_mb INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pricing_plans' AND column_name = 'cpu_percent'
  ) THEN
    ALTER TABLE pricing_plans ADD COLUMN cpu_percent INTEGER;
  END IF;
END $$;

-- Add category check constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pricing_plans_category'
  ) THEN
    ALTER TABLE pricing_plans ADD CONSTRAINT chk_pricing_plans_category CHECK (category IN ('vps', 'minecraft'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pricing_plans_category_active ON pricing_plans(category, is_active, is_archived, display_order);

-- 2. Create pricing_billing_options table
CREATE TABLE IF NOT EXISTS pricing_billing_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(30) NOT NULL DEFAULT 'vps' CHECK (category IN ('vps', 'minecraft')),
    months INTEGER NOT NULL CHECK (months > 0),
    display_name VARCHAR(100) NOT NULL,
    discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (discount_percent >= 0.00 AND discount_percent <= 100.00),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_category_months UNIQUE (category, months)
);

CREATE INDEX IF NOT EXISTS idx_billing_options_category ON pricing_billing_options(category, is_active, display_order);

-- Seed default VPS billing options
INSERT INTO pricing_billing_options (category, months, display_name, discount_percent, display_order)
VALUES
  ('vps', 1, '1 Month', 0.00, 1),
  ('vps', 3, '3 Months (5% off)', 5.00, 2),
  ('vps', 6, '6 Months (10% off)', 10.00, 3),
  ('vps', 12, '12 Months (15% off)', 15.00, 4)
ON CONFLICT (category, months) DO NOTHING;

-- Seed default Minecraft billing options
INSERT INTO pricing_billing_options (category, months, display_name, discount_percent, display_order)
VALUES
  ('minecraft', 1, '1 Month', 0.00, 1),
  ('minecraft', 3, '3 Months', 0.00, 2),
  ('minecraft', 6, '6 Months', 0.00, 3),
  ('minecraft', 12, '12 Months', 0.00, 4)
ON CONFLICT (category, months) DO NOTHING;

-- 3. Seed Minecraft plans into pricing_plans
INSERT INTO pricing_plans (
  name, category, ram_gb, vcpu, storage_gb, memory_mb, cpu_percent, price_inr, price_usd, display_order, description
)
VALUES
  ('Starter', 'minecraft', 2, 1, 10, 2048, 100, 49.00, 1.00, 1, 'Starter Paper Minecraft Server (2GB RAM, 1 vCore)'),
  ('Basic', 'minecraft', 4, 2, 20, 4096, 150, 99.00, 1.50, 2, 'Basic Minecraft Server (4GB RAM, 1.5 vCore)'),
  ('Advanced', 'minecraft', 6, 3, 30, 6144, 250, 149.00, 2.00, 3, 'Advanced Minecraft Server (6GB RAM, 2.5 vCore)'),
  ('Pro', 'minecraft', 8, 3, 40, 8192, 300, 199.00, 2.50, 4, 'Pro Minecraft Server (8GB RAM, 3 vCore)'),
  ('Elite', 'minecraft', 12, 4, 60, 12288, 350, 299.00, 4.00, 5, 'Elite Minecraft Server (12GB RAM, 3.5 vCore)'),
  ('Ultimate', 'minecraft', 16, 4, 80, 16384, 400, 399.00, 5.00, 6, 'Ultimate Minecraft Server (16GB RAM, 4 vCore)'),
  ('Extreme', 'minecraft', 32, 6, 100, 32768, 550, 699.00, 8.00, 7, 'Extreme Minecraft Server (32GB RAM, 5.5 vCore)'),
  ('Titan', 'minecraft', 64, 8, 160, 65536, 800, 1399.00, 17.00, 8, 'Titan High Performance Server (64GB RAM, 8 vCore)')
ON CONFLICT (name) DO UPDATE SET
  category = EXCLUDED.category,
  memory_mb = EXCLUDED.memory_mb,
  cpu_percent = EXCLUDED.cpu_percent,
  display_order = EXCLUDED.display_order,
  description = EXCLUDED.description;

-- 4. Create pricing_audit_logs table
CREATE TABLE IF NOT EXISTS pricing_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN ('plan', 'billing', 'ipv4', 'node', 'display')),
    entity_id VARCHAR(255) NOT NULL,
    administrator_discord_id VARCHAR(32) NOT NULL,
    action VARCHAR(50) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_audit_created_at ON pricing_audit_logs(created_at DESC);
