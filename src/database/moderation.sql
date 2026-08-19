CREATE TABLE IF NOT EXISTS moderation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  matched_rule TEXT NOT NULL,
  message_snapshot TEXT,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_events_user
  ON moderation_events (guild_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_events_guild
  ON moderation_events (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_user_state (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  warning_count INTEGER NOT NULL DEFAULT 0,
  violation_count INTEGER NOT NULL DEFAULT 0,
  last_warning_at TIMESTAMPTZ,
  last_violation_at TIMESTAMPTZ,
  PRIMARY KEY (guild_id, user_id)
);

ALTER TABLE moderation_user_state
  ADD COLUMN IF NOT EXISTS violation_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE moderation_user_state
  ADD COLUMN IF NOT EXISTS last_violation_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS moderation_whitelist (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, user_id)
);
