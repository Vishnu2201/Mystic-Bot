import { pool } from "../config/database";
import { ModerationDetection } from "../moderation/moderationTypes";

export interface ModerationUserState {
  guildId: string;
  userId: string;
  warningCount: number;
  violationCount: number;
  lastWarningAt?: Date;
  lastViolationAt?: Date;
}

export interface ModerationEventRecord {
  id: string;
  category: string;
  severity: string;
  matchedRule: string;
  action: string;
  createdAt: Date;
}

export async function recordModerationEvent(input: {
  guildId: string;
  userId: string;
  channelId: string;
  messageId: string;
  detection: ModerationDetection;
  messageSnapshot: string;
  action: string;
  warningIssued?: boolean;
}): Promise<ModerationUserState> {
  await pool.query(
    `
    INSERT INTO moderation_events (
      guild_id,
      user_id,
      channel_id,
      message_id,
      category,
      severity,
      matched_rule,
      message_snapshot,
      action
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      input.guildId,
      input.userId,
      input.channelId,
      input.messageId,
      input.detection.category,
      input.detection.severity,
      input.detection.rule,
      input.messageSnapshot.slice(0, 1000),
      input.action,
    ]
  );

  const warningIssued = input.warningIssued ?? false;

  const state = await pool.query<ModerationUserState>(
    `
    INSERT INTO moderation_user_state (
      guild_id,
      user_id,
      warning_count,
      violation_count,
      last_warning_at,
      last_violation_at
    )
    VALUES ($1, $2, $3, 1, $4, NOW())
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
      warning_count = moderation_user_state.warning_count + CASE WHEN $3 = 1 THEN 1 ELSE 0 END,
      violation_count = moderation_user_state.violation_count + 1,
      last_warning_at = CASE WHEN $3 = 1 THEN NOW() ELSE moderation_user_state.last_warning_at END,
      last_violation_at = NOW()
    RETURNING
      guild_id AS "guildId",
      user_id AS "userId",
      warning_count AS "warningCount",
      violation_count AS "violationCount",
      last_warning_at AS "lastWarningAt",
      last_violation_at AS "lastViolationAt"
    `,
    [input.guildId, input.userId, warningIssued ? 1 : 0, warningIssued ? new Date() : null]
  );

  return state.rows[0];
}

export async function getModerationUserState(
  guildId: string,
  userId: string
): Promise<ModerationUserState | null> {
  const result = await pool.query<ModerationUserState>(
    `
    SELECT
      guild_id AS "guildId",
      user_id AS "userId",
      warning_count AS "warningCount",
      violation_count AS "violationCount",
      last_warning_at AS "lastWarningAt",
      last_violation_at AS "lastViolationAt"
    FROM moderation_user_state
    WHERE guild_id = $1 AND user_id = $2
    LIMIT 1
    `,
    [guildId, userId]
  );

  return result.rows[0] ?? null;
}

export async function getRecentModerationEvents(
  guildId: string,
  userId: string,
  limit = 10
): Promise<ModerationEventRecord[]> {
  const result = await pool.query<ModerationEventRecord>(
    `
    SELECT
      id,
      category,
      severity,
      matched_rule AS "matchedRule",
      action,
      created_at AS "createdAt"
    FROM moderation_events
    WHERE guild_id = $1 AND user_id = $2
    ORDER BY created_at DESC
    LIMIT $3
    `,
    [guildId, userId, limit]
  );

  return result.rows;
}

export async function setModerationWhitelist(
  guildId: string,
  userId: string,
  addedBy: string
): Promise<void> {
  await pool.query(
    `
    INSERT INTO moderation_whitelist (guild_id, user_id, added_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET added_by = EXCLUDED.added_by
    `,
    [guildId, userId, addedBy]
  );
}

export async function removeModerationWhitelist(
  guildId: string,
  userId: string
): Promise<boolean> {
  const result = await pool.query(
    `
    DELETE FROM moderation_whitelist
    WHERE guild_id = $1 AND user_id = $2
    `,
    [guildId, userId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function isModerationWhitelisted(
  guildId: string,
  userId: string
): Promise<boolean> {
  const result = await pool.query(
    `
    SELECT 1
    FROM moderation_whitelist
    WHERE guild_id = $1 AND user_id = $2
    LIMIT 1
    `,
    [guildId, userId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function getModerationWhitelist(
  guildId: string
): Promise<string[]> {
  const result = await pool.query<{ userId: string }>(
    `
    SELECT user_id AS "userId"
    FROM moderation_whitelist
    WHERE guild_id = $1
    ORDER BY added_at ASC
    `,
    [guildId]
  );

  return result.rows.map((row) => row.userId);
}
