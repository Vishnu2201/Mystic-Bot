-- Migration: Production-grade Discord Referral & Reward System
-- Idempotent & non-destructive migration script for production PostgreSQL.

-- 1. Add billing_source column to vps_instances to distinguish paid vs reward VPS instances
ALTER TABLE vps_instances
  ADD COLUMN IF NOT EXISTS billing_source VARCHAR(50) NOT NULL DEFAULT 'paid';

-- 2. referral_invites table
CREATE TABLE IF NOT EXISTS referral_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(32) NOT NULL,
  discord_invite_id VARCHAR(64),
  inviter_discord_user_id VARCHAR(32) NOT NULL,
  invite_code VARCHAR(64) NOT NULL,
  uses_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_referral_invites_guild_code UNIQUE (guild_id, invite_code)
);

CREATE INDEX IF NOT EXISTS idx_referral_invites_guild_inviter
  ON referral_invites(guild_id, inviter_discord_user_id);

-- 3. referral_rewards table
CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(32) NOT NULL,
  user_discord_id VARCHAR(32) NOT NULL,
  threshold INTEGER NOT NULL DEFAULT 3,
  reward_plan_name VARCHAR(100) NOT NULL DEFAULT 'NANO',
  status VARCHAR(30) NOT NULL DEFAULT 'available', -- 'available', 'claimed'
  claimed_at TIMESTAMPTZ,
  claimed_vps_id UUID REFERENCES vps_instances(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_user_status
  ON referral_rewards(guild_id, user_discord_id, status);

-- 4. referrals table (Authoritative referrer attribution & VPS qualification)
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(32) NOT NULL,
  inviter_discord_user_id VARCHAR(32) NOT NULL,
  referred_discord_user_id VARCHAR(32) NOT NULL,
  referral_invite_id UUID REFERENCES referral_invites(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qualified_at TIMESTAMPTZ,
  qualification_status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending', 'qualified', 'disqualified'
  qualification_reason VARCHAR(255),
  qualifying_vps_id UUID REFERENCES vps_instances(id) ON DELETE SET NULL,
  consumed_for_reward_id UUID REFERENCES referral_rewards(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_referrals_guild_referred UNIQUE (guild_id, referred_discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter_status
  ON referrals(guild_id, inviter_discord_user_id, qualification_status);

CREATE INDEX IF NOT EXISTS idx_referrals_referred_user
  ON referrals(referred_discord_user_id);
