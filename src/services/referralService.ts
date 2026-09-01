import { Client, GuildMember, Invite, User, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../config/database";
import { getCustomerById, getOrCreateCustomer, CustomerRecord } from "./ticketDatabase";
import {
  createVpsInstance,
  updateVpsProvisioningDetails,
  deleteVpsInstanceForProvisionRollback,
  allocatePrivateIpv4,
  VpsInstanceRecord,
} from "./vpsDatabase";
import { provisionAutomaticVps, generateSecureInitialPassword } from "./vpsProvisioningService";
import { allocateAndBuildCustomerInstanceName } from "./vpsNamingService";
import { PublicSshGatewayProvider } from "../providers/publicSshGatewayProvider";
import { refreshVpsManagementDashboard } from "./vpsLifecycle";

const gatewayProvider = new PublicSshGatewayProvider();

// In-memory invite cache: Map<guildId, Map<inviteCode, uses>>
const inviteCache = new Map<string, Map<string, number>>();

export interface UserReferralStats {
  totalAttributed: number;
  totalQualified: number;
  unconsumedQualified: number;
  rewardsEarned: number;
  rewardsClaimed: number;
  rewardsAvailable: number;
  threshold: number;
  progressCurrent: number;
}

export interface LeaderboardEntry {
  inviterDiscordUserId: string;
  qualifiedCount: number;
}

export function getReferralRewardThreshold(): number {
  const raw = process.env.REFERRAL_REWARD_THRESHOLD?.trim();
  const parsed = raw ? parseInt(raw, 10) : 3;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3;
}

export function getReferralRewardPlanName(): string {
  return process.env.REFERRAL_REWARD_PLAN?.trim() || "NANO";
}

/**
 * Execute idempotent database migration script for referrals tables
 */
export async function runReferralMigration(): Promise<void> {
  try {
    const migrationPath = path.join(__dirname, "..", "database", "referrals.sql");
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, "utf-8");
      await pool.query(sql);
      console.log("✅ Referral database migration applied successfully.");
    } else {
      console.warn(`[Referral System] Migration file not found at ${migrationPath}`);
    }
  } catch (err) {
    console.error("❌ Failed to run referral database migration:", err);
    throw err;
  }
}

/**
 * Sync all guild invites at bot startup and populate inviteCache
 */
export async function syncGuildInvites(client: Client): Promise<void> {
  try {
    for (const guild of client.guilds.cache.values()) {
      try {
        const guildMap = new Map<string, number>();
        const invites = await guild.invites.fetch().catch(() => null);
        if (!invites) {
          console.warn(`[Referrals] Unable to fetch invites for guild "${guild.name}" (${guild.id}). Ensure the bot has "Manage Server" (MANAGE_GUILD) permission.`);
          continue;
        }

        for (const inv of invites.values()) {
          guildMap.set(inv.code, inv.uses ?? 0);

          if (inv.inviter) {
            await pool.query(
              `INSERT INTO referral_invites (
                 guild_id, discord_invite_id, inviter_discord_user_id, invite_code, uses_count, active, updated_at
               )
               VALUES ($1, $2, $3, $4, $5, true, NOW())
               ON CONFLICT (guild_id, invite_code)
               DO UPDATE SET
                 uses_count = EXCLUDED.uses_count,
                 active = true,
                 updated_at = NOW()`,
              [guild.id, inv.code, inv.inviter.id, inv.code, inv.uses ?? 0]
            );
          }
        }

        inviteCache.set(guild.id, guildMap);
        console.log(`[Referrals] Synced ${invites.size} invites for guild "${guild.name}" (${guild.id}).`);
      } catch (guildErr) {
        console.warn(`[Referrals] Could not fetch invites for guild "${guild.name}":`, guildErr);
      }
    }
  } catch (err) {
    console.error("[Referrals] Error during guild invites sync:", err);
  }
}

/**
 * Handle new invite creation
 */
export async function handleInviteCreate(invite: Invite): Promise<void> {
  if (!invite.guild || !invite.code || !invite.inviter) return;

  const guildId = invite.guild.id;
  let guildMap = inviteCache.get(guildId);
  if (!guildMap) {
    guildMap = new Map<string, number>();
    inviteCache.set(guildId, guildMap);
  }

  guildMap.set(invite.code, invite.uses ?? 0);

  try {
    await pool.query(
      `INSERT INTO referral_invites (
         guild_id, discord_invite_id, inviter_discord_user_id, invite_code, uses_count, active, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, true, NOW())
       ON CONFLICT (guild_id, invite_code)
       DO UPDATE SET
         uses_count = EXCLUDED.uses_count,
         active = true,
         updated_at = NOW()`,
      [guildId, invite.code, invite.inviter.id, invite.code, invite.uses ?? 0]
    );
  } catch (err) {
    console.error(`[Referrals] Failed to record created invite ${invite.code}:`, err);
  }
}

/**
 * Handle invite deletion
 */
export async function handleInviteDelete(invite: Invite): Promise<void> {
  if (!invite.guild || !invite.code) return;

  const guildId = invite.guild.id;
  const guildMap = inviteCache.get(guildId);
  if (guildMap) {
    guildMap.delete(invite.code);
  }

  try {
    await pool.query(
      `UPDATE referral_invites SET active = false, updated_at = NOW() WHERE guild_id = $1 AND invite_code = $2`,
      [guildId, invite.code]
    );
  } catch (err) {
    console.error(`[Referrals] Failed to mark deleted invite ${invite.code}:`, err);
  }
}

/**
 * Track member join and attribute to inviter
 */
export async function trackMemberJoin(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  const guildId = member.guild.id;
  const memberId = member.id;

  try {
    // Leave/rejoin protection: If member already has a referral record in this guild, preserve attribution
    const existing = await pool.query(
      `SELECT id, inviter_discord_user_id FROM referrals WHERE guild_id = $1 AND referred_discord_user_id = $2 LIMIT 1`,
      [guildId, memberId]
    );

    if (existing.rows.length > 0) {
      console.log(`[Referrals] Member ${member.user.tag} (${memberId}) rejoined guild. Preserved original referral record.`);
      return;
    }

    const cachedMap = inviteCache.get(guildId) || new Map<string, number>();
    const currentInvites = await member.guild.invites.fetch().catch(() => null);

    let usedCode: string | null = null;
    let inviterId: string | null = null;

    if (currentInvites) {
      for (const inv of currentInvites.values()) {
        const oldUses = cachedMap.get(inv.code) ?? 0;
        const newUses = inv.uses ?? 0;

        if (newUses > oldUses) {
          usedCode = inv.code;
          inviterId = inv.inviter?.id ?? null;
          cachedMap.set(inv.code, newUses);
          break;
        }
      }
    }

    if (!usedCode || !inviterId) {
      console.log(`[Referrals] Join by ${member.user.tag} (${memberId}) could not be confidently attributed (vanity/unknown/deleted invite). Recorded as unattributed.`);
      return;
    }

    if (usedCode && inviterId) {
      // Anti-fraud: Self referral check
      if (inviterId === memberId) {
        console.warn(`[Referrals] Anti-fraud trigger: Self-referral detected for ${member.user.tag} (${memberId}).`);
        await pool.query(
          `INSERT INTO referrals (
             guild_id, inviter_discord_user_id, referred_discord_user_id, joined_at, qualification_status, qualification_reason
           )
           VALUES ($1, $2, $3, NOW(), 'disqualified', 'self_referral')
           ON CONFLICT (guild_id, referred_discord_user_id) DO NOTHING`,
          [guildId, inviterId, memberId]
        );
        return;
      }

      // Record authoritative referral attribution (ON CONFLICT DO NOTHING guarantees 1 referred user = 1 referrer)
      await pool.query(
        `INSERT INTO referrals (
           guild_id, inviter_discord_user_id, referred_discord_user_id, joined_at, qualification_status
         )
         VALUES ($1, $2, $3, NOW(), 'pending')
         ON CONFLICT (guild_id, referred_discord_user_id) DO NOTHING`,
        [guildId, inviterId, memberId]
      );

      console.log(`[Referrals] Attributed join of ${member.user.tag} (${memberId}) to inviter <@${inviterId}> via code "${usedCode}".`);
    }
  } catch (err) {
    console.error(`[Referrals] Error during join tracking for member ${member.user.tag}:`, err);
  }
}

/**
 * Evaluate referral qualification when a VPS is successfully provisioned
 */
export async function evaluateReferralQualification(
  customerId: string,
  vpsId: string,
  guildId?: string,
  isRewardClaim = false
): Promise<void> {
  if (isRewardClaim) {
    console.log(`[Referrals] VPS ${vpsId} was provisioned as a free referral reward. Bypassing qualification.`);
    return;
  }

  try {
    const customer = await getCustomerById(customerId);
    if (!customer || !customer.discordUserId) return;

    const targetGuildId = guildId || process.env.GUILD_ID;
    if (!targetGuildId) return;

    // Check Anti-Fraud: Has customer already owned any VPS instance prior to this one?
    const previousVpsCheck = await pool.query(
      `SELECT COUNT(*) AS count FROM vps_instances WHERE customer_id = $1 AND id != $2`,
      [customerId, vpsId]
    );

    const hasPreviousVps = parseInt(previousVpsCheck.rows[0].count, 10) > 0;

    if (hasPreviousVps) {
      console.log(`[Referrals] Customer ${customer.discordUserId} already owned previous VPS. Referral not eligible for duplicate qualification.`);
      await pool.query(
        `UPDATE referrals
         SET qualification_status = 'disqualified', qualification_reason = 'existing_customer_additional_vps'
         WHERE guild_id = $1 AND referred_discord_user_id = $2 AND qualification_status = 'pending'`,
        [targetGuildId, customer.discordUserId]
      );
      return;
    }

    // Qualify pending referral if present
    const qualRes = await pool.query<{ id: string; inviter_discord_user_id: string }>(
      `UPDATE referrals
       SET qualification_status = 'qualified',
           qualified_at = NOW(),
           qualifying_vps_id = $1
       WHERE guild_id = $2
         AND referred_discord_user_id = $3
         AND qualification_status = 'pending'
       RETURNING id, inviter_discord_user_id`,
      [vpsId, targetGuildId, customer.discordUserId]
    );

    if (qualRes.rows.length === 0) {
      return;
    }

    const inviterId = qualRes.rows[0].inviter_discord_user_id;
    console.log(`[Referrals] 🎉 Referral qualified! Inviter <@${inviterId}> earned qualification credit for customer ${customer.discordUserId}.`);

    // Check reward eligibility for inviter
    const threshold = getReferralRewardThreshold();

    const qualCountRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM referrals
       WHERE guild_id = $1 AND inviter_discord_user_id = $2 AND qualification_status = 'qualified'`,
      [targetGuildId, inviterId]
    );

    const totalQualified = parseInt(qualCountRes.rows[0].count, 10);
    const earnedRewardCount = Math.floor(totalQualified / threshold);

    const existingRewardRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM referral_rewards
       WHERE guild_id = $1 AND user_discord_id = $2`,
      [targetGuildId, inviterId]
    );

    const existingRewardCount = parseInt(existingRewardRes.rows[0].count, 10);

    if (earnedRewardCount > existingRewardCount) {
      const newRewardsToCreate = earnedRewardCount - existingRewardCount;
      const planName = getReferralRewardPlanName();

      for (let i = 0; i < newRewardsToCreate; i++) {
        await pool.query(
          `INSERT INTO referral_rewards (
             guild_id, user_discord_id, threshold, reward_plan_name, status, created_at
           )
           VALUES ($1, $2, $3, $4, 'available', NOW())`,
          [targetGuildId, inviterId, threshold, planName]
        );
      }

      console.log(`[Referrals] 🎁 User <@${inviterId}> earned ${newRewardsToCreate} new free VPS reward(s)!`);
    }
  } catch (err) {
    console.error("[Referrals] Error during referral qualification evaluation:", err);
  }
}

/**
 * Claim an available free VPS reward atomically
 */
export async function claimReferralReward(
  guildId: string,
  userDiscordId: string,
  username: string,
  displayName: string,
  client: Client
): Promise<{ vps: VpsInstanceRecord; credentialPassword: string }> {
  const dbClient = await pool.connect();
  let createdVpsId: string | undefined = undefined;

  try {
    await dbClient.query("BEGIN");

    // 1. Row-lock an available reward to prevent race conditions / duplicate claims
    const rewardRes = await dbClient.query<{ id: string; threshold: number; reward_plan_name: string }>(
      `SELECT id, threshold, reward_plan_name
       FROM referral_rewards
       WHERE guild_id = $1 AND user_discord_id = $2 AND status = 'available'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE`,
      [guildId, userDiscordId]
    );

    if (rewardRes.rows.length === 0) {
      await dbClient.query("ROLLBACK");
      const threshold = getReferralRewardThreshold();
      throw new Error(`❌ You need ${threshold} successful VPS referrals to claim a free VPS.`);
    }

    const reward = rewardRes.rows[0];
    const planName = reward.reward_plan_name || getReferralRewardPlanName();

    // 2. Fetch plan specs from pricing_plans or default
    const planRes = await dbClient.query<{ ram_gb: number; vcpu: number; storage_gb: number; price_inr: number; price_usd: number }>(
      `SELECT ram_gb, vcpu, storage_gb, price_inr, price_usd
       FROM pricing_plans
       WHERE LOWER(name) = LOWER($1)
       LIMIT 1`,
      [planName]
    );

    if (planRes.rows.length === 0) {
      await dbClient.query("ROLLBACK");
      console.error(`[Referral System] Configured reward plan "${planName}" was not found in pricing_plans table.`);
      throw new Error(`❌ Configured referral reward plan "${planName}" is not available in the pricing system. Please contact support.`);
    }

    const ramGb = planRes.rows[0].ram_gb;
    const vcpu = planRes.rows[0].vcpu;
    const storageGb = planRes.rows[0].storage_gb;
    const location = "India";

    // 3. Create or get customer record inside transaction
    const customer = await getOrCreateCustomer(userDiscordId, username, displayName, dbClient);

    // 4. Allocate instance naming & password
    const password = generateSecureInitialPassword();

    // Allocate customer sequence & instance name
    const naming = await allocateAndBuildCustomerInstanceName(customer.id, username);

    // Allocate persistent private IPv4 & public SSH port
    const staticPrivateIpv4 = await allocatePrivateIpv4();

    // Create database VPS record with billing_source = 'referral_reward' inside transaction
    const vps = await createVpsInstance({
      customerId: customer.id,
      planName: `${planName.toUpperCase()} (Reward)`,
      location,
      priceInr: 0,
      priceUsd: 0,
      ramGb,
      vcpu,
      storageGb,
      providerInstanceId: naming.instanceName,
      hostname: naming.instanceName,
      instanceName: naming.instanceName,
      customerVpsSequence: naming.sequence,
      privateIpv4: staticPrivateIpv4,
      sshUsername: "root",
      sshPort: 22,
      provisionedByDiscordId: userDiscordId,
      billingCycleMonths: 1,
    }, dbClient);

    createdVpsId = vps.id;
    vps.vpsNumber = Number(vps.vpsNumber);

    // Update billing_source to 'referral_reward'
    await dbClient.query(
      `UPDATE vps_instances SET billing_source = 'referral_reward' WHERE id = $1`,
      [vps.id]
    );

    // 5. Provision LXC container
    const provisionResult = await provisionAutomaticVps({
      vpsNumber: vps.vpsNumber,
      containerName: naming.instanceName,
      hostname: naming.instanceName,
      ramGb,
      vcpu,
      storageGb,
      staticPrivateIpv4,
      initialPassword: password,
    });

    const provisionedVps = await updateVpsProvisioningDetails({
      id: vps.id,
      providerInstanceId: provisionResult.containerName,
      hostname: provisionResult.hostname,
      privateIpv4: provisionResult.privateIpv4 ?? staticPrivateIpv4,
      sshUsername: "root",
      sshPort: 22,
    });

    // 6. Configure public SSH gateway DNAT mapping
    const pubPort = provisionedVps.publicSshPort;
    const privIp = provisionedVps.privateIpv4 ?? staticPrivateIpv4;
    if (pubPort && privIp) {
      await gatewayProvider.ensureMapping(pubPort, privIp, 22);
    }

    // 7. Mark reward claimed
    await dbClient.query(
      `UPDATE referral_rewards
       SET status = 'claimed', claimed_at = NOW(), claimed_vps_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [vps.id, reward.id]
    );

    // 8. Consume the required referrals for this reward
    await dbClient.query(
      `UPDATE referrals
       SET consumed_for_reward_id = $1, updated_at = NOW()
       WHERE id IN (
         SELECT id FROM referrals
         WHERE guild_id = $2
           AND inviter_discord_user_id = $3
           AND qualification_status = 'qualified'
           AND consumed_for_reward_id IS NULL
         ORDER BY qualified_at ASC
         LIMIT $4
       )`,
      [reward.id, guildId, userDiscordId, reward.threshold]
    );

    await dbClient.query("COMMIT");
    createdVpsId = undefined; // Disarm rollback

    await refreshVpsManagementDashboard(client);

    console.log(`[Referrals] 🎉 Free VPS reward claimed by <@${userDiscordId}> -> VPS #${vps.vpsNumber} (${naming.instanceName}).`);

    return { vps: provisionedVps, credentialPassword: password };
  } catch (err) {
    await dbClient.query("ROLLBACK").catch(() => null);

    if (createdVpsId) {
      try {
        await deleteVpsInstanceForProvisionRollback(createdVpsId);
      } catch (rollbackErr) {
        console.error("❌ Failed to rollback database VPS instance on reward claim failure:", rollbackErr);
      }
    }

    throw err;
  } finally {
    dbClient.release();
  }
}

/**
 * Get user referral statistics for /invites command
 */
export async function getUserReferralStats(
  guildId: string,
  userDiscordId: string
): Promise<UserReferralStats> {
  const threshold = getReferralRewardThreshold();

  const totalAttrRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM referrals WHERE guild_id = $1 AND inviter_discord_user_id = $2`,
    [guildId, userDiscordId]
  );

  const totalQualRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM referrals WHERE guild_id = $1 AND inviter_discord_user_id = $2 AND qualification_status = 'qualified'`,
    [guildId, userDiscordId]
  );

  const unconsumedQualRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM referrals WHERE guild_id = $1 AND inviter_discord_user_id = $2 AND qualification_status = 'qualified' AND consumed_for_reward_id IS NULL`,
    [guildId, userDiscordId]
  );

  const earnedRewRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM referral_rewards WHERE guild_id = $1 AND user_discord_id = $2`,
    [guildId, userDiscordId]
  );

  const claimedRewRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM referral_rewards WHERE guild_id = $1 AND user_discord_id = $2 AND status = 'claimed'`,
    [guildId, userDiscordId]
  );

  const availRewRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM referral_rewards WHERE guild_id = $1 AND user_discord_id = $2 AND status = 'available'`,
    [guildId, userDiscordId]
  );

  const totalAttributed = parseInt(totalAttrRes.rows[0]?.count ?? "0", 10);
  const totalQualified = parseInt(totalQualRes.rows[0]?.count ?? "0", 10);
  const unconsumedQualified = parseInt(unconsumedQualRes.rows[0]?.count ?? "0", 10);
  const rewardsEarned = parseInt(earnedRewRes.rows[0]?.count ?? "0", 10);
  const rewardsClaimed = parseInt(claimedRewRes.rows[0]?.count ?? "0", 10);
  const rewardsAvailable = parseInt(availRewRes.rows[0]?.count ?? "0", 10);

  const progressCurrent = unconsumedQualified % threshold;

  return {
    totalAttributed,
    totalQualified,
    unconsumedQualified,
    rewardsEarned,
    rewardsClaimed,
    rewardsAvailable,
    threshold,
    progressCurrent,
  };
}

/**
 * Get referral leaderboard
 */
export async function getReferralLeaderboard(
  guildId: string,
  limit = 10
): Promise<LeaderboardEntry[]> {
  const res = await pool.query<{ inviter_discord_user_id: string; qualified_count: string }>(
    `SELECT inviter_discord_user_id, COUNT(*) AS qualified_count
     FROM referrals
     WHERE guild_id = $1 AND qualification_status = 'qualified'
     GROUP BY inviter_discord_user_id
     ORDER BY qualified_count DESC
     LIMIT $2`,
    [guildId, limit]
  );

  return res.rows.map((row) => ({
    inviterDiscordUserId: row.inviter_discord_user_id,
    qualifiedCount: parseInt(row.qualified_count, 10),
  }));
}

/**
 * Get detailed staff breakdown for /invites admin user:<user>
 */
export async function getAdminUserReferralBreakdown(
  guildId: string,
  targetDiscordId: string
): Promise<{
  stats: UserReferralStats;
  recentReferrals: Array<{ referredUserId: string; status: string; joinedAt: Date; qualifiedAt?: Date; reason?: string }>;
  rewards: Array<{ id: string; status: string; claimedAt?: Date; vpsId?: string }>;
}> {
  const stats = await getUserReferralStats(guildId, targetDiscordId);

  const refRes = await pool.query<{
    referred_discord_user_id: string;
    qualification_status: string;
    joined_at: Date;
    qualified_at?: Date;
    qualification_reason?: string;
  }>(
    `SELECT referred_discord_user_id, qualification_status, joined_at, qualified_at, qualification_reason
     FROM referrals
     WHERE guild_id = $1 AND inviter_discord_user_id = $2
     ORDER BY joined_at DESC
     LIMIT 25`,
    [guildId, targetDiscordId]
  );

  const rewRes = await pool.query<{
    id: string;
    status: string;
    claimed_at?: Date;
    claimed_vps_id?: string;
  }>(
    `SELECT id, status, claimed_at, claimed_vps_id
     FROM referral_rewards
     WHERE guild_id = $1 AND user_discord_id = $2
     ORDER BY created_at DESC`,
    [guildId, targetDiscordId]
  );

  return {
    stats,
    recentReferrals: refRes.rows.map((r) => ({
      referredUserId: r.referred_discord_user_id,
      status: r.qualification_status,
      joinedAt: r.joined_at,
      qualifiedAt: r.qualified_at,
      reason: r.qualification_reason,
    })),
    rewards: rewRes.rows.map((w) => ({
      id: w.id,
      status: w.status,
      claimedAt: w.claimed_at,
      vpsId: w.claimed_vps_id,
    })),
  };
}
