-- Initial Base Schema for Mystic Bot (Customers & Tickets)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_user_id VARCHAR(32) UNIQUE NOT NULL,
    username VARCHAR(100),
    display_name VARCHAR(100),
    vps_sequence_counter INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number BIGSERIAL UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    department VARCHAR(50) NOT NULL,
    status VARCHAR(30) DEFAULT 'open',
    discord_guild_id VARCHAR(32),
    discord_channel_id VARCHAR(32),
    claimed_by_discord_id VARCHAR(32),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ
);
