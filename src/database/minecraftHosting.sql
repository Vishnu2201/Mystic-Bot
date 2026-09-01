-- Migration: Minecraft Hosting Pterodactyl Integration
-- Safe and idempotent migration for production database.

-- Add Pterodactyl User ID and Minecraft Sequence Counter to customers table
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS pterodactyl_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS minecraft_sequence_counter INTEGER NOT NULL DEFAULT 0;

-- Create index on customers.pterodactyl_user_id
CREATE INDEX IF NOT EXISTS idx_customers_pterodactyl_user_id
  ON customers(pterodactyl_user_id)
  WHERE pterodactyl_user_id IS NOT NULL;

-- Create minecraft_servers table
CREATE TABLE IF NOT EXISTS minecraft_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    server_number BIGSERIAL UNIQUE NOT NULL,

    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,

    pterodactyl_server_id INTEGER UNIQUE NOT NULL,
    pterodactyl_identifier VARCHAR(50) NOT NULL,
    pterodactyl_user_id INTEGER NOT NULL,

    server_name VARCHAR(255) NOT NULL,
    customer_minecraft_sequence INTEGER NOT NULL,

    plan_id VARCHAR(50) NOT NULL,
    plan_name VARCHAR(100) NOT NULL,

    price_inr NUMERIC(10,2) NOT NULL,
    price_usd NUMERIC(10,2) NOT NULL,

    ram_mb INTEGER NOT NULL,
    cpu_limit INTEGER NOT NULL,
    storage_mb INTEGER NOT NULL,

    allocation_id INTEGER NOT NULL,
    allocation_ip VARCHAR(50) NOT NULL,
    allocation_port INTEGER NOT NULL,

    customer_hostname VARCHAR(255) NOT NULL DEFAULT 'minecraft.mysticservers.com',

    ssh_username VARCHAR(100) NOT NULL DEFAULT 'root',
    ssh_port INTEGER NOT NULL DEFAULT 22,

    billing_cycle_months INTEGER NOT NULL DEFAULT 1,
    provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 month'),
    renewal_count INTEGER NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'active',

    provisioned_by_discord_id VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for minecraft_servers
CREATE INDEX IF NOT EXISTS idx_minecraft_servers_customer_id
    ON minecraft_servers(customer_id);

CREATE INDEX IF NOT EXISTS idx_minecraft_servers_pterodactyl_server_id
    ON minecraft_servers(pterodactyl_server_id);

CREATE INDEX IF NOT EXISTS idx_minecraft_servers_status
    ON minecraft_servers(status);

CREATE INDEX IF NOT EXISTS idx_minecraft_servers_expires_at
    ON minecraft_servers(expires_at);

-- Enforce uniqueness for per-customer sequence numbers on Minecraft instances
CREATE UNIQUE INDEX IF NOT EXISTS idx_minecraft_servers_customer_sequence
  ON minecraft_servers(customer_id, customer_minecraft_sequence);

-- Enforce uniqueness for ticket-based provisioning (prevents duplicate provisioning per ticket)
CREATE UNIQUE INDEX IF NOT EXISTS idx_minecraft_servers_ticket_id
  ON minecraft_servers(ticket_id)
  WHERE ticket_id IS NOT NULL;
