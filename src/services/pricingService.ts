import fs from "fs";
import path from "path";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from "discord.js";
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

export interface PricingDisplaySettings {
  id: string;
  category: "vps" | "minecraft";
  title: string;
  subtitle?: string | null;
  description?: string | null;
  locationName?: string | null;
  countryCode?: string | null;
  countryFlag?: string | null;
  nodeName?: string | null;
  hostname?: string | null;
  planSectionTitle?: string | null;
  featuresSectionTitle?: string | null;
  features: string[];
  footer?: string | null;
  purchaseInstruction?: string | null;
  updatedAt?: Date;
  updatedByDiscordId?: string | null;
}

export type PricingLocation = "India" | "Singapore" | "Japan";

/**
 * Executes idempotent database migration for the unified pricing catalog & display settings.
 */
export async function runCatalogMigration(): Promise<void> {
  try {
    const files = ["catalogMigration.sql", "displaySettingsMigration.sql"];

    for (const file of files) {
      const candidate1 = path.join(__dirname, "..", "database", file);
      const candidate2 = path.join(process.cwd(), "src", "database", file);
      const migrationPath = fs.existsSync(candidate1)
        ? candidate1
        : fs.existsSync(candidate2)
        ? candidate2
        : null;

      if (migrationPath) {
        const sql = fs.readFileSync(migrationPath, "utf-8");
        await pool.query(sql);
        console.log(`✅ Database migration [${file}] applied successfully.`);
      } else {
        console.warn(`[Catalog System] Migration file not found at ${candidate1} or ${candidate2}`);
      }
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
 * Fetch catalog plans from database
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
 * Fetch Display Settings for Category
 */
export async function getDisplaySettings(category: "vps" | "minecraft"): Promise<PricingDisplaySettings> {
  const result = await pool.query<any>(
    `
    SELECT
      id,
      category,
      title,
      subtitle,
      description,
      location_name AS "locationName",
      country_code AS "countryCode",
      country_flag AS "countryFlag",
      node_name AS "nodeName",
      hostname,
      plan_section_title AS "planSectionTitle",
      features_section_title AS "featuresSectionTitle",
      features,
      footer,
      purchase_instruction AS "purchaseInstruction",
      updated_at AS "updatedAt",
      updated_by_discord_id AS "updatedByDiscordId"
    FROM pricing_display_settings
    WHERE LOWER(category) = LOWER($1)
    LIMIT 1
    `,
    [category]
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];
    const features = Array.isArray(row.features) ? row.features : typeof row.features === "string" ? JSON.parse(row.features) : [];
    return { ...row, features };
  }

  // Fallback default
  return {
    id: "default",
    category,
    title: category === "vps" ? "🌐 MysticServers VPS Pricing" : "🎮 MysticServers — Minecraft Hosting",
    subtitle: category === "vps" ? "RELIABLE VPS HOSTING & INFRASTRUCTURE" : "HIGH PERFORMANCE MINECRAFT HOSTING",
    description: category === "vps"
      ? "Reliable VPS hosting and infrastructure built for developers, businesses and projects."
      : "Instant deployment Paper/Java Minecraft servers powered by high-frequency CPUs.",
    locationName: category === "vps" ? "India" : "India Node",
    countryFlag: "🇮🇳",
    nodeName: "LXC-01",
    hostname: category === "vps" ? "ssh.mysticservers.com" : "minecraft.mysticservers.com",
    planSectionTitle: category === "vps" ? "VPS PLANS" : "AVAILABLE PLANS",
    featuresSectionTitle: category === "vps" ? "✨ Included With Every VPS" : "✨ Included With Every Server",
    features: category === "vps"
      ? ["⚡ Full Root Access", "🚀 Instant Provisioning", "💬 Discord Support"]
      : ["⚡ Paper / Java 25 Ready", "🚀 Instant Automatic Provisioning", "🎛️ Full Pterodactyl Panel Control", "💬 24/7 Discord Support"],
    footer: category === "vps" ? "MysticServers • VPS Hosting" : "MysticServers • Minecraft Hosting",
    purchaseInstruction: category === "vps" ? "Select a VPS plan below to continue." : "Select a plan below to create a purchase ticket.",
  };
}

/**
 * Update Display Settings for Category
 */
export async function updateDisplaySettings(
  category: "vps" | "minecraft",
  input: {
    title?: string;
    subtitle?: string;
    description?: string;
    locationName?: string;
    countryFlag?: string;
    nodeName?: string;
    hostname?: string;
    planSectionTitle?: string;
    featuresSectionTitle?: string;
    features?: string[];
    footer?: string;
    purchaseInstruction?: string;
  },
  adminDiscordId: string
): Promise<PricingDisplaySettings> {
  const existing = await getDisplaySettings(category);

  const title = input.title ?? existing.title;
  const subtitle = input.subtitle !== undefined ? input.subtitle : existing.subtitle;
  const description = input.description !== undefined ? input.description : existing.description;
  const locationName = input.locationName !== undefined ? input.locationName : existing.locationName;
  const countryFlag = input.countryFlag !== undefined ? input.countryFlag : existing.countryFlag;
  const nodeName = input.nodeName !== undefined ? input.nodeName : existing.nodeName;
  const hostname = input.hostname !== undefined ? input.hostname : existing.hostname;
  const planSectionTitle = input.planSectionTitle !== undefined ? input.planSectionTitle : existing.planSectionTitle;
  const featuresSectionTitle = input.featuresSectionTitle !== undefined ? input.featuresSectionTitle : existing.featuresSectionTitle;
  const features = input.features !== undefined ? input.features : existing.features;
  const footer = input.footer !== undefined ? input.footer : existing.footer;
  const purchaseInstruction = input.purchaseInstruction !== undefined ? input.purchaseInstruction : existing.purchaseInstruction;

  await pool.query(
    `
    INSERT INTO pricing_display_settings (
      category, title, subtitle, description, location_name, country_flag, node_name, hostname,
      plan_section_title, features_section_title, features, footer, purchase_instruction,
      updated_at, updated_by_discord_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14)
    ON CONFLICT (category) DO UPDATE SET
      title = EXCLUDED.title,
      subtitle = EXCLUDED.subtitle,
      description = EXCLUDED.description,
      location_name = EXCLUDED.location_name,
      country_flag = EXCLUDED.country_flag,
      node_name = EXCLUDED.node_name,
      hostname = EXCLUDED.hostname,
      plan_section_title = EXCLUDED.plan_section_title,
      features_section_title = EXCLUDED.features_section_title,
      features = EXCLUDED.features,
      footer = EXCLUDED.footer,
      purchase_instruction = EXCLUDED.purchase_instruction,
      updated_at = NOW(),
      updated_by_discord_id = EXCLUDED.updated_by_discord_id
    `,
    [
      category,
      title,
      subtitle,
      description,
      locationName,
      countryFlag,
      nodeName,
      hostname,
      planSectionTitle,
      featuresSectionTitle,
      JSON.stringify(features),
      footer,
      purchaseInstruction,
      adminDiscordId,
    ]
  );

  const updated = await getDisplaySettings(category);
  await logPricingAudit("plan", category, adminDiscordId, "display_settings_updated", existing, updated);
  return updated;
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

// Helper for location flag emojis
function locationEmoji(location: PricingLocation): string {
  if (location === "India") return "🇮🇳";
  if (location === "Singapore") return "🇸🇬";
  return "🇯🇵";
}

/**
 * CENTRAL RENDERER: VPS Public Pricing Panel
 */
export async function renderVpsPricingPanel(location: PricingLocation = "India") {
  const plans = await getActivePlans("vps");
  const settings = await getDisplaySettings("vps");

  const title = settings.title || "🌐 MysticServers VPS Pricing";
  const subtitle = settings.subtitle ? `**${settings.subtitle}**\n\n` : "";
  const desc = settings.description ? `${settings.description}\n\n` : "";
  const locLine = `📍 **Location:** ${locationEmoji(location)} ${location}\n\n`;
  const planTitle = settings.planSectionTitle ? `**${settings.planSectionTitle}**\n\n` : "";

  const planLines = plans.map(
    (p) =>
      `**${p.name}** — **₹${p.priceInr} / $${p.priceUsd} per month**\n` +
      `🧠 ${p.ramGb}GB RAM | 💾 ${p.storageGb}GB Disk | ⚡ ${p.vcpu} vCore\n`
  ).join("\n");

  const featureTitle = settings.featuresSectionTitle ? `\n\n${settings.featuresSectionTitle}\n\n` : "\n\n";
  const featureLines = settings.features.map((f) => `${f}`).join("\n");
  const instruction = settings.purchaseInstruction ? `\n\n${settings.purchaseInstruction}` : "";

  const descriptionContent =
    `${subtitle}${desc}${locLine}` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${planTitle}${planLines}` +
    `\n━━━━━━━━━━━━━━━━━━━━` +
    `${featureTitle}${featureLines}${instruction}`;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(descriptionContent)
    .setFooter({ text: settings.footer || "MysticServers • Only you can see this" });

  const options = plans.map((p) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${p.name} • ₹${p.priceInr} / $${p.priceUsd}`)
      .setDescription(`${p.ramGb}GB RAM • ${p.storageGb}GB Disk • ${p.vcpu} vCore`)
      .setEmoji("🖥️")
      .setValue(`pricing:plan:${location}:${p.id}`)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(`pricing:plan:${location}`)
    .setPlaceholder("Select a VPS plan")
    .addOptions(options);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const locationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("pricing:location:India")
      .setLabel("India")
      .setEmoji("🇮🇳")
      .setStyle(location === "India" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("pricing:location:Singapore")
      .setLabel("Singapore")
      .setEmoji("🇸🇬")
      .setStyle(location === "Singapore" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("pricing:location:Japan")
      .setLabel("Japan")
      .setEmoji("🇯🇵")
      .setStyle(location === "Japan" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [selectRow, locationRow],
  };
}

/**
 * CENTRAL RENDERER: Minecraft Public Pricing Panel
 */
export async function renderMinecraftPricingPanel() {
  const plans = await getActivePlans("minecraft");
  const settings = await getDisplaySettings("minecraft");

  const title = settings.title || "🎮 MysticServers — Minecraft Hosting";
  const subtitle = settings.subtitle ? `**${settings.subtitle}**\n\n` : "";
  const desc = settings.description ? `${settings.description}\n\n` : "";
  const locFlag = settings.countryFlag || "🇮🇳";
  const locName = settings.locationName || "India Node";
  const nodeName = settings.nodeName || "LXC-01";
  const hostname = settings.hostname || "minecraft.mysticservers.com";

  const locLine = `📍 **Location:** ${locFlag} ${locName} ${nodeName}\n🌐 **Hostname:** \`${hostname}\`\n\n`;
  const planTitle = settings.planSectionTitle ? `**${settings.planSectionTitle}**\n\n` : "";

  const planLines = plans.map(
    (p) =>
      `**${p.name}** — **₹${p.priceInr} / $${p.priceUsd} per month**\n` +
      `🧠 ${p.ramGb} GB RAM • ⚡ ${p.cpuPercent ?? (p.vcpu * 100)}% CPU • 💾 ${p.storageGb} GB Disk\n`
  ).join("\n");

  const featureTitle = settings.featuresSectionTitle ? `\n\n${settings.featuresSectionTitle}\n\n` : "\n\n";
  const featureLines = settings.features.map((f) => `${f}`).join("\n");
  const instruction = settings.purchaseInstruction ? `\n\n${settings.purchaseInstruction}` : "";

  const descriptionContent =
    `${subtitle}${desc}${locLine}` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${planTitle}${planLines}` +
    `\n━━━━━━━━━━━━━━━━━━━━` +
    `${featureTitle}${featureLines}${instruction}`;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(title)
    .setDescription(descriptionContent)
    .setFooter({ text: settings.footer || "MysticServers • Minecraft Hosting" });

  const options = plans.map((p) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${p.name} • ₹${p.priceInr}/mo ($${p.priceUsd})`)
      .setDescription(`${p.ramGb}GB RAM • ${p.cpuPercent ?? (p.vcpu * 100)}% CPU • ${p.storageGb}GB Disk`)
      .setEmoji("🎮")
      .setValue(`minecraft:plan:${p.id}`)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("minecraft:plan:select")
    .setPlaceholder("Select a Minecraft plan")
    .addOptions(options);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  return {
    embeds: [embed],
    components: [selectRow],
  };
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

    const vpsPanel = await renderVpsPricingPanel("India");
    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const existingMsg = messages?.find((m) => m.author.id === client.user?.id);

    if (existingMsg) {
      await existingMsg.edit({ embeds: vpsPanel.embeds, components: vpsPanel.components });
    } else {
      await channel.send({ embeds: vpsPanel.embeds, components: vpsPanel.components });
    }
  } catch (err) {
    console.error("[Catalog System] Failed to refresh public pricing channel:", err);
  }
}