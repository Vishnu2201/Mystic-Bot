import fs from "fs";
import path from "path";
import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { pool } from "../config/database";

export interface CatalogPlan {
  id: string;
  category: "vps" | "minecraft";
  name: string;
  description?: string | null;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  memoryMb?: number | null;
  cpuPercent?: number | null;
  priceInr: number;
  priceUsd: number;
  isActive: boolean;
  isArchived: boolean;
  displayOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BillingOption {
  id: string;
  category: "vps" | "minecraft";
  months: number;
  displayName: string;
  discountPercent: number;
  isActive: boolean;
  displayOrder: number;
}

export interface IPv4Plan {
  id: string;
  durationMonths: number;
  priceInr: number;
  priceUsd?: number;
  isActive: boolean;
  displayOrder: number;
}

export interface PricingAuditLog {
  id: string;
  entityType: "plan" | "billing" | "ipv4";
  entityId: string;
  administratorDiscordId: string;
  action: string;
  oldValues?: any;
  newValues?: any;
  createdAt: Date;
}

/**
 * Executes idempotent database migration for the unified pricing catalog.
 */
export async function runCatalogMigration(): Promise<void> {
  try {
    const candidate1 = path.join(__dirname, "..", "database", "catalogMigration.sql");
    const candidate2 = path.join(process.cwd(), "src", "database", "catalogMigration.sql");
    const migrationPath = fs.existsSync(candidate1)
      ? candidate1
      : fs.existsSync(candidate2)
      ? candidate2
      : null;

    if (migrationPath) {
      const sql = fs.readFileSync(migrationPath, "utf-8");
      await pool.query(sql);
      console.log("✅ Unified catalog database migration applied successfully.");
    } else {
      console.warn(`[Catalog System] Migration file not found at ${candidate1} or ${candidate2}`);
    }
  } catch (err) {
    console.error("❌ Failed to run catalog database migration:", err);
    throw err;
  }
}

/**
 * Log administrative pricing changes for auditing
 */
export async function logPricingAudit(
  entityType: "plan" | "billing" | "ipv4",
  entityId: string,
  administratorDiscordId: string,
  action: string,
  oldValues?: any,
  newValues?: any
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO pricing_audit_logs (
         entity_type, entity_id, administrator_discord_id, action, old_values, new_values, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        entityType,
        entityId,
        administratorDiscordId,
        action,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
      ]
    );
  } catch (err) {
    console.error("[Catalog Audit] Failed to write pricing audit log:", err);
  }
}

/**
 * Get catalog plans for a specific category or all categories
 */
export async function getPricingPlans(
  category: "vps" | "minecraft" = "vps",
  includeInactive = false
): Promise<CatalogPlan[]> {
  const query = `
    SELECT
      id,
      category,
      name,
      description,
      ram_gb AS "ramGb",
      vcpu,
      storage_gb AS "storageGb",
      memory_mb AS "memoryMb",
      cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr",
      price_usd::float AS "priceUsd",
      is_active AS "isActive",
      is_archived AS "isArchived",
      display_order AS "displayOrder",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM pricing_plans
    WHERE LOWER(category) = LOWER($1)
      AND is_archived = FALSE
      ${includeInactive ? "" : "AND is_active = TRUE"}
    ORDER BY display_order ASC, price_inr ASC
  `;

  const result = await pool.query<CatalogPlan>(query, [category]);
  return result.rows;
}

export async function getActivePlans(category: "vps" | "minecraft"): Promise<CatalogPlan[]> {
  return getPricingPlans(category, false);
}

export async function getPricingPlanById(id: string): Promise<CatalogPlan | null> {
  const result = await pool.query<CatalogPlan>(
    `
    SELECT
      id,
      category,
      name,
      description,
      ram_gb AS "ramGb",
      vcpu,
      storage_gb AS "storageGb",
      memory_mb AS "memoryMb",
      cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr",
      price_usd::float AS "priceUsd",
      is_active AS "isActive",
      is_archived AS "isArchived",
      display_order AS "displayOrder",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM pricing_plans
    WHERE (id::text = $1 OR LOWER(name) = LOWER($1))
    LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function getMinecraftPlans(includeInactive = false): Promise<CatalogPlan[]> {
  return getPricingPlans("minecraft", includeInactive);
}

export async function getMinecraftPlanById(id: string): Promise<CatalogPlan | null> {
  const result = await pool.query<CatalogPlan>(
    `
    SELECT
      id,
      category,
      name,
      description,
      ram_gb AS "ramGb",
      vcpu,
      storage_gb AS "storageGb",
      memory_mb AS "memoryMb",
      cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr",
      price_usd::float AS "priceUsd",
      is_active AS "isActive",
      is_archived AS "isArchived",
      display_order AS "displayOrder",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM pricing_plans
    WHERE category = 'minecraft'
      AND (id::text = $1 OR LOWER(name) = LOWER($1))
    LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

/**
 * Admin: Create catalog plan
 */
export async function createCatalogPlan(
  input: {
    category: "vps" | "minecraft";
    name: string;
    description?: string;
    ramGb: number;
    vcpu: number;
    storageGb: number;
    memoryMb?: number;
    cpuPercent?: number;
    priceInr: number;
    priceUsd: number;
    displayOrder?: number;
  },
  adminDiscordId: string
): Promise<CatalogPlan> {
  const memoryMb = input.memoryMb ?? input.ramGb * 1024;
  const cpuPercent = input.cpuPercent ?? input.vcpu * 100;
  const displayOrder = input.displayOrder ?? 0;

  const result = await pool.query<CatalogPlan>(
    `
    INSERT INTO pricing_plans (
      category, name, description, ram_gb, vcpu, storage_gb, memory_mb, cpu_percent,
      price_inr, price_usd, display_order, is_active, is_archived
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, FALSE)
    RETURNING
      id, category, name, description,
      ram_gb AS "ramGb", vcpu, storage_gb AS "storageGb",
      memory_mb AS "memoryMb", cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr", price_usd::float AS "priceUsd",
      is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    `,
    [
      input.category,
      input.name,
      input.description ?? null,
      input.ramGb,
      input.vcpu,
      input.storageGb,
      memoryMb,
      cpuPercent,
      input.priceInr,
      input.priceUsd,
      displayOrder,
    ]
  );

  const newPlan = result.rows[0];
  await logPricingAudit("plan", newPlan.id, adminDiscordId, "created", null, newPlan);
  return newPlan;
}

/**
 * Admin: Update catalog plan
 */
export async function updateCatalogPlan(
  id: string,
  input: {
    name?: string;
    description?: string;
    ramGb?: number;
    vcpu?: number;
    storageGb?: number;
    memoryMb?: number;
    cpuPercent?: number;
    priceInr?: number;
    priceUsd?: number;
    displayOrder?: number;
  },
  adminDiscordId: string
): Promise<CatalogPlan> {
  const existing = await getPricingPlanById(id);
  if (!existing) {
    throw new Error(`Plan with ID ${id} not found.`);
  }

  const name = input.name ?? existing.name;
  const description = input.description !== undefined ? input.description : existing.description;
  const ramGb = input.ramGb ?? existing.ramGb;
  const vcpu = input.vcpu ?? existing.vcpu;
  const storageGb = input.storageGb ?? existing.storageGb;
  const memoryMb = input.memoryMb ?? (input.ramGb ? input.ramGb * 1024 : existing.memoryMb);
  const cpuPercent = input.cpuPercent ?? (input.vcpu ? input.vcpu * 100 : existing.cpuPercent);
  const priceInr = input.priceInr ?? existing.priceInr;
  const priceUsd = input.priceUsd ?? existing.priceUsd;
  const displayOrder = input.displayOrder ?? existing.displayOrder;

  const result = await pool.query<CatalogPlan>(
    `
    UPDATE pricing_plans
    SET name = $1, description = $2, ram_gb = $3, vcpu = $4, storage_gb = $5,
        memory_mb = $6, cpu_percent = $7, price_inr = $8, price_usd = $9,
        display_order = $10, updated_at = NOW()
    WHERE id = $11
    RETURNING
      id, category, name, description,
      ram_gb AS "ramGb", vcpu, storage_gb AS "storageGb",
      memory_mb AS "memoryMb", cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr", price_usd::float AS "priceUsd",
      is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    `,
    [name, description, ramGb, vcpu, storageGb, memoryMb, cpuPercent, priceInr, priceUsd, displayOrder, id]
  );

  const updatedPlan = result.rows[0];
  await logPricingAudit("plan", id, adminDiscordId, "updated", existing, updatedPlan);
  return updatedPlan;
}

/**
 * Admin: Toggle plan active state
 */
export async function togglePlanActive(id: string, adminDiscordId: string): Promise<CatalogPlan> {
  const existing = await getPricingPlanById(id);
  if (!existing) throw new Error("Plan not found.");

  const nextState = !existing.isActive;
  const result = await pool.query<CatalogPlan>(
    `UPDATE pricing_plans SET is_active = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, category, name, is_active AS "isActive"`,
    [nextState, id]
  );

  const updated = result.rows[0];
  await logPricingAudit("plan", id, adminDiscordId, nextState ? "enabled" : "disabled", existing, updated);
  return updated;
}

/**
 * Admin: Archive plan
 */
export async function archivePlan(id: string, adminDiscordId: string): Promise<CatalogPlan> {
  const existing = await getPricingPlanById(id);
  if (!existing) throw new Error("Plan not found.");

  const result = await pool.query<CatalogPlan>(
    `UPDATE pricing_plans SET is_archived = TRUE, is_active = FALSE, updated_at = NOW() WHERE id = $1
     RETURNING id, category, name, is_archived AS "isArchived"`,
    [id]
  );

  const updated = result.rows[0];
  await logPricingAudit("plan", id, adminDiscordId, "archived", existing, updated);
  return updated;
}

/**
 * Fetch billing options for category
 */
export async function getBillingOptions(
  category: "vps" | "minecraft" = "vps",
  includeInactive = false
): Promise<BillingOption[]> {
  const result = await pool.query<BillingOption>(
    `
    SELECT
      id, category, months,
      display_name AS "displayName",
      discount_percent::float AS "discountPercent",
      is_active AS "isActive",
      display_order AS "displayOrder"
    FROM pricing_billing_options
    WHERE LOWER(category) = LOWER($1)
      ${includeInactive ? "" : "AND is_active = TRUE"}
    ORDER BY display_order ASC, months ASC
    `,
    [category]
  );

  return result.rows;
}

/**
 * Update billing option discount
 */
export async function updateBillingOption(
  id: string,
  discountPercent: number,
  adminDiscordId: string
): Promise<BillingOption> {
  const existingRes = await pool.query<BillingOption>(
    `SELECT id, category, months, discount_percent::float AS "discountPercent" FROM pricing_billing_options WHERE id = $1`,
    [id]
  );
  if (existingRes.rows.length === 0) throw new Error("Billing option not found.");

  const existing = existingRes.rows[0];
  const result = await pool.query<BillingOption>(
    `UPDATE pricing_billing_options SET discount_percent = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, category, months, discount_percent::float AS "discountPercent"`,
    [discountPercent, id]
  );

  const updated = result.rows[0];
  await logPricingAudit("billing", id, adminDiscordId, "discount_updated", existing, updated);
  return updated;
}

/**
 * Fetch IPv4 pricing plans
 */
export async function getIPv4Plans(includeInactive = false): Promise<IPv4Plan[]> {
  const result = await pool.query<IPv4Plan>(
    `
    SELECT
      id,
      duration_months AS "durationMonths",
      price_inr::float AS "priceInr",
      is_active AS "isActive",
      display_order AS "displayOrder"
    FROM pricing_ipv4
    ${includeInactive ? "" : "WHERE is_active = TRUE"}
    ORDER BY display_order ASC, duration_months ASC
    `
  );

  return result.rows;
}

/**
 * Deterministic price calculation service function
 */
export async function calculatePrice(
  planId: string,
  billingMonths: number,
  category: "vps" | "minecraft" = "vps"
): Promise<{
  baseMonthlyInr: number;
  baseMonthlyUsd: number;
  months: number;
  discountPercent: number;
  totalInr: number;
  totalUsd: number;
}> {
  const plan = await getPricingPlanById(planId);
  if (!plan) throw new Error("Catalog plan not found.");

  const options = await getBillingOptions(category, true);
  const matchingOption = options.find((o) => o.months === billingMonths && o.isActive);

  const discountPercent = matchingOption ? matchingOption.discountPercent : 0.0;

  const rawBaseInr = plan.priceInr * billingMonths;
  const rawBaseUsd = plan.priceUsd * billingMonths;

  const discountFactor = (100 - discountPercent) / 100;
  const totalInr = Math.round(rawBaseInr * discountFactor * 100) / 100;
  const totalUsd = Math.round(rawBaseUsd * discountFactor * 100) / 100;

  return {
    baseMonthlyInr: plan.priceInr,
    baseMonthlyUsd: plan.priceUsd,
    months: billingMonths,
    discountPercent,
    totalInr,
    totalUsd,
  };
}

/**
 * Fetch audit logs for staff inspection
 */
export async function getPricingAuditLogs(limit = 10): Promise<PricingAuditLog[]> {
  const result = await pool.query<PricingAuditLog>(
    `
    SELECT
      id,
      entity_type AS "entityType",
      entity_id AS "entityId",
      administrator_discord_id AS "administratorDiscordId",
      action,
      old_values AS "oldValues",
      new_values AS "newValues",
      created_at AS "createdAt"
    FROM pricing_audit_logs
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

/**
 * Auto-refresh public pricing channel if PRICING_CHANNEL_ID is set
 */
export async function refreshPricingChannel(client: Client): Promise<void> {
  const channelId = process.env.PRICING_CHANNEL_ID?.trim();
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    // Fetch active VPS plans from database
    const plans = await getActivePlans("vps");
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🌐 MysticServers VPS Pricing")
      .setDescription(
        "**RELIABLE VPS HOSTING & INFRASTRUCTURE**\n\n" +
          plans
            .map(
              (p) =>
                `**${p.name}** — **₹${p.priceInr} / $${p.priceUsd} per month**\n` +
                `🧠 ${p.ramGb}GB RAM | 💾 ${p.storageGb}GB Disk | ⚡ ${p.vcpu} vCore\n`
            )
            .join("\n") +
          "\n━━━━━━━━━━━━━━━━━━━━\n\n" +
          "⚡ Full Root Access • 🚀 Instant Provisioning • 💬 Discord Support"
      )
      .setFooter({ text: "MysticServers • Updated from Catalog" })
      .setTimestamp();

    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const existingMsg = messages?.find((m) => m.author.id === client.user?.id);

    if (existingMsg) {
      await existingMsg.edit({ embeds: [embed] });
    } else {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error("[Catalog System] Failed to refresh public pricing channel:", err);
  }
}