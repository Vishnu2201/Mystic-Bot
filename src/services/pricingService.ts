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

export interface HostingNode {
  id: string;
  category: "vps" | "minecraft" | "both";
  displayName: string;
  countryCode: string;
  countryFlag: string;
  locationName: string;
  nodeName: string;
  hostname: string;
  isActive: boolean;
  isArchived: boolean;
  displayOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PricingAuditLog {
  id: string;
  entityType: "plan" | "billing" | "ipv4" | "node";
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
  planSectionTitle?: string | null;
  featuresSectionTitle?: string | null;
  features: string[];
  footer?: string | null;
  purchaseInstruction?: string | null;
  updatedAt?: Date;
  updatedByDiscordId?: string | null;
}

export type PricingLocation = string;

/**
 * Executes idempotent database migration for catalog, settings, and hosting nodes.
 */
export async function runCatalogMigration(): Promise<void> {
  try {
    const files = ["catalogMigration.sql", "displaySettingsMigration.sql", "nodeMigration.sql"];

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
 * Log administrative pricing & node changes for auditing
 */
export async function logPricingAudit(
  entityType: "plan" | "billing" | "ipv4" | "node",
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
 * Fetch active database hosting nodes (Single Source of Truth)
 */
export async function getHostingNodes(
  category?: "vps" | "minecraft",
  includeInactive = false
): Promise<HostingNode[]> {
  let categoryFilter = "";
  const params: any[] = [];

  if (category) {
    categoryFilter = `AND (LOWER(category) = LOWER($1) OR LOWER(category) = 'both')`;
    params.push(category);
  }

  const query = `
    SELECT
      id,
      category,
      display_name AS "displayName",
      country_code AS "countryCode",
      country_flag AS "countryFlag",
      location_name AS "locationName",
      node_name AS "nodeName",
      hostname,
      is_active AS "isActive",
      is_archived AS "isArchived",
      display_order AS "displayOrder",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM hosting_nodes
    WHERE is_archived = FALSE
      ${includeInactive ? "" : "AND is_active = TRUE"}
      ${categoryFilter}
    ORDER BY display_order ASC, location_name ASC
  `;

  const result = await pool.query<HostingNode>(query, params);
  return result.rows;
}

export async function getActiveHostingNodes(category?: "vps" | "minecraft"): Promise<HostingNode[]> {
  return getHostingNodes(category, false);
}

export async function getHostingNodeById(id: string): Promise<HostingNode | null> {
  const result = await pool.query<HostingNode>(
    `
    SELECT
      id, category,
      display_name AS "displayName",
      country_code AS "countryCode",
      country_flag AS "countryFlag",
      location_name AS "locationName",
      node_name AS "nodeName",
      hostname,
      is_active AS "isActive",
      is_archived AS "isArchived",
      display_order AS "displayOrder"
    FROM hosting_nodes
    WHERE (id::text = $1 OR LOWER(node_name) = LOWER($1) OR LOWER(location_name) = LOWER($1))
    LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function createHostingNode(
  input: {
    category: "vps" | "minecraft" | "both";
    displayName: string;
    countryCode: string;
    countryFlag: string;
    locationName: string;
    nodeName: string;
    hostname: string;
    displayOrder?: number;
  },
  adminDiscordId: string
): Promise<HostingNode> {
  const result = await pool.query<HostingNode>(
    `
    INSERT INTO hosting_nodes (
      category, display_name, country_code, country_flag, location_name, node_name, hostname,
      is_active, is_archived, display_order, created_by_discord_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, FALSE, $8, $9)
    RETURNING
      id, category, display_name AS "displayName", country_code AS "countryCode",
      country_flag AS "countryFlag", location_name AS "locationName", node_name AS "nodeName",
      hostname, is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    `,
    [
      input.category,
      input.displayName,
      input.countryCode,
      input.countryFlag,
      input.locationName,
      input.nodeName,
      input.hostname,
      input.displayOrder ?? 1,
      adminDiscordId,
    ]
  );

  const newNode = result.rows[0];
  await logPricingAudit("node", newNode.id, adminDiscordId, "node_created", null, newNode);
  return newNode;
}

export async function updateHostingNode(
  id: string,
  input: {
    category?: "vps" | "minecraft" | "both";
    displayName?: string;
    countryCode?: string;
    countryFlag?: string;
    locationName?: string;
    nodeName?: string;
    hostname?: string;
    displayOrder?: number;
  },
  adminDiscordId: string
): Promise<HostingNode> {
  const existing = await getHostingNodeById(id);
  if (!existing) throw new Error("Hosting node not found.");

  const category = input.category ?? existing.category;
  const displayName = input.displayName ?? existing.displayName;
  const countryCode = input.countryCode ?? existing.countryCode;
  const countryFlag = input.countryFlag ?? existing.countryFlag;
  const locationName = input.locationName ?? existing.locationName;
  const nodeName = input.nodeName ?? existing.nodeName;
  const hostname = input.hostname ?? existing.hostname;
  const displayOrder = input.displayOrder ?? existing.displayOrder;

  const result = await pool.query<HostingNode>(
    `
    UPDATE hosting_nodes
    SET category = $1, display_name = $2, country_code = $3, country_flag = $4, location_name = $5,
        node_name = $6, hostname = $7, display_order = $8, updated_at = NOW(), updated_by_discord_id = $9
    WHERE id = $10
    RETURNING
      id, category, display_name AS "displayName", country_code AS "countryCode",
      country_flag AS "countryFlag", location_name AS "locationName", node_name AS "nodeName",
      hostname, is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    `,
    [category, displayName, countryCode, countryFlag, locationName, nodeName, hostname, displayOrder, adminDiscordId, id]
  );

  const updatedNode = result.rows[0];
  await logPricingAudit("node", id, adminDiscordId, "node_updated", existing, updatedNode);
  return updatedNode;
}

export async function toggleHostingNodeActive(id: string, adminDiscordId: string): Promise<HostingNode> {
  const existing = await getHostingNodeById(id);
  if (!existing) throw new Error("Hosting node not found.");

  const nextState = !existing.isActive;
  const result = await pool.query<HostingNode>(
    `UPDATE hosting_nodes SET is_active = $1, updated_at = NOW(), updated_by_discord_id = $2 WHERE id = $3
     RETURNING id, display_name AS "displayName", is_active AS "isActive"`,
    [nextState, adminDiscordId, id]
  );

  const updated = result.rows[0];
  await logPricingAudit("node", id, adminDiscordId, nextState ? "node_enabled" : "node_disabled", existing, updated);
  return updated;
}

export async function archiveHostingNode(id: string, adminDiscordId: string): Promise<HostingNode> {
  const existing = await getHostingNodeById(id);
  if (!existing) throw new Error("Hosting node not found.");

  const result = await pool.query<HostingNode>(
    `UPDATE hosting_nodes SET is_archived = TRUE, is_active = FALSE, updated_at = NOW(), updated_by_discord_id = $1 WHERE id = $2
     RETURNING id, display_name AS "displayName", is_archived AS "isArchived"`,
    [adminDiscordId, id]
  );

  const updated = result.rows[0];
  await logPricingAudit("node", id, adminDiscordId, "node_archived", existing, updated);
  return updated;
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
      id, category, name, description,
      ram_gb AS "ramGb", vcpu, storage_gb AS "storageGb",
      memory_mb AS "memoryMb", cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr", price_usd::float AS "priceUsd",
      is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    FROM pricing_plans
    WHERE LOWER(category) = LOWER($1) AND is_archived = FALSE
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
      id, category, name, description,
      ram_gb AS "ramGb", vcpu, storage_gb AS "storageGb",
      memory_mb AS "memoryMb", cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr", price_usd::float AS "priceUsd",
      is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
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
  return getPricingPlanById(id);
}

/**
 * Fetch Display Settings for Category
 */
export async function getDisplaySettings(category: "vps" | "minecraft"): Promise<PricingDisplaySettings> {
  const result = await pool.query<any>(
    `
    SELECT
      id, category, title, subtitle, description,
      plan_section_title AS "planSectionTitle",
      features_section_title AS "featuresSectionTitle",
      features, footer, purchase_instruction AS "purchaseInstruction"
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

  return {
    id: "default",
    category,
    title: category === "vps" ? "🌐 MysticServers VPS Pricing" : "🎮 MysticServers — Minecraft Hosting",
    subtitle: category === "vps" ? "RELIABLE VPS HOSTING & INFRASTRUCTURE" : "HIGH PERFORMANCE MINECRAFT HOSTING",
    description: category === "vps"
      ? "Reliable VPS hosting and infrastructure built for developers, businesses and projects."
      : "Instant deployment Paper/Java Minecraft servers powered by high-frequency CPUs.",
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
 * Update Display Settings
 */
export async function updateDisplaySettings(
  category: "vps" | "minecraft",
  input: {
    title?: string;
    subtitle?: string;
    description?: string;
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
  const planSectionTitle = input.planSectionTitle !== undefined ? input.planSectionTitle : existing.planSectionTitle;
  const featuresSectionTitle = input.featuresSectionTitle !== undefined ? input.featuresSectionTitle : existing.featuresSectionTitle;
  const features = input.features !== undefined ? input.features : existing.features;
  const footer = input.footer !== undefined ? input.footer : existing.footer;
  const purchaseInstruction = input.purchaseInstruction !== undefined ? input.purchaseInstruction : existing.purchaseInstruction;

  await pool.query(
    `
    INSERT INTO pricing_display_settings (
      category, title, subtitle, description,
      plan_section_title, features_section_title, features, footer, purchase_instruction,
      updated_at, updated_by_discord_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
    ON CONFLICT (category) DO UPDATE SET
      title = EXCLUDED.title,
      subtitle = EXCLUDED.subtitle,
      description = EXCLUDED.description,
      plan_section_title = EXCLUDED.plan_section_title,
      features_section_title = EXCLUDED.features_section_title,
      features = EXCLUDED.features,
      footer = EXCLUDED.footer,
      purchase_instruction = EXCLUDED.purchase_instruction,
      updated_at = NOW(),
      updated_by_discord_id = EXCLUDED.updated_by_discord_id
    `,
    [category, title, subtitle, description, planSectionTitle, featuresSectionTitle, JSON.stringify(features), footer, purchaseInstruction, adminDiscordId]
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
  if (!existing) throw new Error(`Plan with ID ${id} not found.`);

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

export async function getIPv4Plans(includeInactive = false): Promise<IPv4Plan[]> {
  const result = await pool.query<IPv4Plan>(
    `
    SELECT
      id, duration_months AS "durationMonths", price_inr::float AS "priceInr",
      is_active AS "isActive", display_order AS "displayOrder"
    FROM pricing_ipv4
    ${includeInactive ? "" : "WHERE is_active = TRUE"}
    ORDER BY display_order ASC, duration_months ASC
    `
  );

  return result.rows;
}

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

export async function getPricingAuditLogs(limit = 10): Promise<PricingAuditLog[]> {
  const result = await pool.query<PricingAuditLog>(
    `
    SELECT
      id, entity_type AS "entityType", entity_id AS "entityId",
      administrator_discord_id AS "administratorDiscordId", action,
      old_values AS "oldValues", new_values AS "newValues", created_at AS "createdAt"
    FROM pricing_audit_logs
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

/**
 * CENTRAL RENDERER: VPS Public Pricing Panel
 * Node selector derived 100% dynamically from hosting_nodes in PostgreSQL!
 */
export async function renderVpsPricingPanel(selectedNodeId?: string) {
  const plans = await getActivePlans("vps");
  const settings = await getDisplaySettings("vps");
  const nodes = await getActiveHostingNodes("vps");

  if (nodes.length === 0) {
    throw new Error("No active hosting nodes found in database.");
  }

  const selectedNode = (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null) || nodes[0];

  const title = settings.title || "🌐 MysticServers VPS Pricing";
  const subtitle = settings.subtitle ? `**${settings.subtitle}**\n\n` : "";
  const desc = settings.description ? `${settings.description}\n\n` : "";
  const locLine = `📍 **Location:** ${selectedNode.countryFlag} ${selectedNode.locationName} (${selectedNode.nodeName})\n🌐 **Gateway Host:** \`${selectedNode.hostname}\`\n\n`;
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
    .setFooter({ text: settings.footer || "MysticServers • VPS Hosting" });

  const planOptions = plans.map((p) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${p.name} • ₹${p.priceInr} / $${p.priceUsd}`)
      .setDescription(`${p.ramGb}GB RAM • ${p.storageGb}GB Disk • ${p.vcpu} vCore`)
      .setEmoji("🖥️")
      .setValue(`pricing:plan:${selectedNode.id}:${p.id}`)
  );

  const planSelect = new StringSelectMenuBuilder()
    .setCustomId(`pricing:plan:${selectedNode.id}`)
    .setPlaceholder("Select a VPS plan")
    .addOptions(planOptions);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(planSelect);

  // Dynamic database-backed node selector row
  const nodeOptions = nodes.map((n) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${n.countryFlag} ${n.displayName}`)
      .setDescription(`Location: ${n.locationName} • Node: ${n.nodeName}`)
      .setValue(`pricing:node:select:${n.id}`)
      .setDefault(n.id === selectedNode.id)
  );

  const nodeSelect = new StringSelectMenuBuilder()
    .setCustomId("pricing:node:select")
    .setPlaceholder("📍 Select Hosting Location / Node")
    .addOptions(nodeOptions);

  const nodeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(nodeSelect);

  return {
    embeds: [embed],
    components: [selectRow, nodeRow],
    selectedNode,
  };
}

/**
 * CENTRAL RENDERER: Minecraft Public Pricing Panel
 * Node selector derived 100% dynamically from hosting_nodes in PostgreSQL!
 */
export async function renderMinecraftPricingPanel(selectedNodeId?: string) {
  const plans = await getActivePlans("minecraft");
  const settings = await getDisplaySettings("minecraft");
  const nodes = await getActiveHostingNodes("minecraft");

  if (nodes.length === 0) {
    throw new Error("No active hosting nodes found in database.");
  }

  const selectedNode = (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null) || nodes[0];

  const title = settings.title || "🎮 MysticServers — Minecraft Hosting";
  const subtitle = settings.subtitle ? `**${settings.subtitle}**\n\n` : "";
  const desc = settings.description ? `${settings.description}\n\n` : "";
  const locLine = `📍 **Location:** ${selectedNode.countryFlag} ${selectedNode.locationName} (${selectedNode.nodeName})\n🌐 **Hostname:** \`${selectedNode.hostname}\`\n\n`;
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

  const planOptions = plans.map((p) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${p.name} • ₹${p.priceInr}/mo ($${p.priceUsd})`)
      .setDescription(`${p.ramGb}GB RAM • ${p.cpuPercent ?? (p.vcpu * 100)}% CPU • ${p.storageGb}GB Disk`)
      .setEmoji("🎮")
      .setValue(`minecraft:plan:${selectedNode.id}:${p.id}`)
  );

  const planSelect = new StringSelectMenuBuilder()
    .setCustomId(`minecraft:plan:${selectedNode.id}`)
    .setPlaceholder("Select a Minecraft plan")
    .addOptions(planOptions);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(planSelect);

  // Dynamic database-backed node selector row
  const nodeOptions = nodes.map((n) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${n.countryFlag} ${n.displayName}`)
      .setDescription(`Location: ${n.locationName} • Node: ${n.nodeName}`)
      .setValue(`minecraft:node:select:${n.id}`)
      .setDefault(n.id === selectedNode.id)
  );

  const nodeSelect = new StringSelectMenuBuilder()
    .setCustomId("minecraft:node:select")
    .setPlaceholder("📍 Select Hosting Location / Node")
    .addOptions(nodeOptions);

  const nodeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(nodeSelect);

  return {
    embeds: [embed],
    components: [selectRow, nodeRow],
    selectedNode,
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

    const vpsPanel = await renderVpsPricingPanel();
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