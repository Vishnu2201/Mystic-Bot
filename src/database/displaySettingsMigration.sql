-- ============================================================
-- Display Settings & Presentation Migration (Phase 1.5)
-- ============================================================

CREATE TABLE IF NOT EXISTS pricing_display_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(30) UNIQUE NOT NULL CHECK (category IN ('vps', 'minecraft')),
    title VARCHAR(255) NOT NULL,
    subtitle VARCHAR(255),
    description TEXT,
    location_name VARCHAR(255),
    country_code VARCHAR(10),
    country_flag VARCHAR(10),
    node_name VARCHAR(255),
    hostname VARCHAR(255),
    plan_section_title VARCHAR(255),
    features_section_title VARCHAR(255),
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    footer TEXT,
    purchase_instruction TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_discord_id VARCHAR(32)
);

-- Seed default display settings for VPS
INSERT INTO pricing_display_settings (
    category, title, subtitle, description, location_name, country_flag, node_name, hostname,
    plan_section_title, features_section_title, features, footer, purchase_instruction
)
VALUES (
    'vps',
    '🌐 MysticServers VPS Pricing',
    'RELIABLE VPS HOSTING & INFRASTRUCTURE',
    'Reliable VPS hosting and infrastructure built for developers, businesses and projects.',
    'India',
    '🇮🇳',
    'LXC-01',
    'ssh.mysticservers.com',
    'VPS PLANS',
    '✨ Included With Every VPS',
    '["⚡ Full Root Access", "🚀 Instant Provisioning", "💬 Discord Support", "🌐 IPv4/IPv6 availability depends on provider and location"]'::jsonb,
    'MysticServers • VPS Hosting',
    'Select a VPS plan below to continue.'
)
ON CONFLICT (category) DO NOTHING;

-- Seed default display settings for Minecraft
INSERT INTO pricing_display_settings (
    category, title, subtitle, description, location_name, country_flag, node_name, hostname,
    plan_section_title, features_section_title, features, footer, purchase_instruction
)
VALUES (
    'minecraft',
    '🎮 MysticServers — Minecraft Hosting',
    'HIGH PERFORMANCE MINECRAFT HOSTING',
    'Instant deployment Paper/Java Minecraft servers powered by high-frequency CPUs.',
    'India Node',
    '🇮🇳',
    'LXC-01',
    'minecraft.mysticservers.com',
    'AVAILABLE PLANS',
    '✨ Included With Every Server',
    '["⚡ Paper / Java 25 Ready", "🚀 Instant Automatic Provisioning", "🎛️ Full Pterodactyl Panel Control", "💬 24/7 Discord Support"]'::jsonb,
    'MysticServers • Minecraft Hosting',
    'Select a plan below to create a purchase ticket.'
)
ON CONFLICT (category) DO NOTHING;

-- Safe update of default VPS plan specs & pricing to match current catalog request
UPDATE pricing_plans SET ram_gb = 3, storage_gb = 40, price_usd = 1.10 WHERE category = 'vps' AND name = 'Nano' AND price_inr = 99;
UPDATE pricing_plans SET ram_gb = 8, storage_gb = 70, price_usd = 2.00 WHERE category = 'vps' AND name = 'Plus' AND price_inr = 169;
UPDATE pricing_plans SET ram_gb = 14, storage_gb = 90, price_usd = 3.50 WHERE category = 'vps' AND name = 'Power' AND price_inr = 329;
UPDATE pricing_plans SET ram_gb = 16, storage_gb = 95, price_usd = 4.50 WHERE category = 'vps' AND name = 'Ultra' AND price_inr = 399;
UPDATE pricing_plans SET ram_gb = 24, storage_gb = 100, price_usd = 6.50 WHERE category = 'vps' AND name = 'Max' AND price_inr = 599;

-- Safe update of default Minecraft plan specs & pricing to match current catalog request
UPDATE pricing_plans SET ram_gb = 6, memory_mb = 6144, cpu_percent = 150, storage_gb = 60, price_inr = 129, price_usd = 1.39 WHERE category = 'minecraft' AND name = 'Basic';
UPDATE pricing_plans SET ram_gb = 12, memory_mb = 12288, cpu_percent = 250, storage_gb = 85, price_inr = 279, price_usd = 2.99 WHERE category = 'minecraft' AND name = 'Advanced';
UPDATE pricing_plans SET ram_gb = 10, memory_mb = 10240, cpu_percent = 300, storage_gb = 80, price_inr = 219, price_usd = 2.39 WHERE category = 'minecraft' AND name = 'Pro';
UPDATE pricing_plans SET ram_gb = 20, memory_mb = 20480, cpu_percent = 550, storage_gb = 98, price_inr = 499, price_usd = 5.49 WHERE category = 'minecraft' AND name = 'Extreme';
