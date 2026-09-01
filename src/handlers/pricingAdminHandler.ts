import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  Interaction,
  PermissionFlagsBits,
} from "discord.js";

import {
  getPricingPlans,
  getPricingPlanById,
  createCatalogPlan,
  updateCatalogPlan,
  togglePlanActive,
  archivePlan,
  getBillingOptions,
  updateBillingOption,
  getIPv4Plans,
  getPricingAuditLogs,
  refreshPricingChannel,
} from "../services/pricingService";

/**
 * Verifies that the user interacting with admin pricing has Administrator permissions or Support role.
 */
export function checkAdminAuth(interaction: Interaction): boolean {
  if (!interaction.guild || !interaction.member) return false;
  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (!member) return false;

  const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);
  const supportRoleId = process.env.SUPPORT_ROLE_ID?.trim();
  const isSupport = supportRoleId ? member.roles.cache.has(supportRoleId) : false;

  return isAdministrator || isSupport;
}

/**
 * Main dashboard embed and buttons for /admin-pricing
 */
export async function renderAdminPricingMainDashboard() {
  const vpsPlans = await getPricingPlans("vps", true);
  const mcPlans = await getPricingPlans("minecraft", true);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("⚙️ MYSTIC SERVERS — PRICING CATALOG CONTROL PANEL")
    .setDescription(
      "Welcome Administrator! Select a product category below to manage live pricing, plan specifications, discounts, and availability.\n\n" +
        `🖥️ **VPS Catalog:** ${vpsPlans.length} plans (${vpsPlans.filter((p) => p.isActive).length} active)\n` +
        `🎮 **Minecraft Catalog:** ${mcPlans.length} plans (${mcPlans.filter((p) => p.isActive).length} active)\n` +
        "🌐 **IPv4 Add-ons:** Custom multi-month billing\n" +
        "🗓️ **Billing Discounts:** 1m, 3m, 6m, 12m rules\n\n" +
        "Select an option below to proceed."
    )
    .setFooter({ text: "MysticServers Catalog Administration" })
    .setTimestamp();

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("admin_pricing:category:vps").setLabel("VPS Plans").setEmoji("🖥️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_pricing:category:minecraft").setLabel("Minecraft Plans").setEmoji("🎮").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_pricing:category:ipv4").setLabel("IPv4 Plans").setEmoji("🌐").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("admin_pricing:category:billing").setLabel("Billing Discounts").setEmoji("🗓️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("admin_pricing:category:history").setLabel("Audit History").setEmoji("📜").setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [buttons] };
}

/**
 * Category management dashboard (VPS or Minecraft)
 */
export async function renderCategoryDashboard(category: "vps" | "minecraft") {
  const plans = await getPricingPlans(category, true);
  const isVps = category === "vps";

  const lines = plans.length === 0
    ? ["*No plans found in database for this category.*"]
    : plans.map((p) => {
        const statusEmoji = p.isActive ? "✅" : "⛔";
        const specs = isVps
          ? `${p.ramGb}GB RAM | ${p.vcpu} vCore | ${p.storageGb}GB Disk`
          : `${p.memoryMb ?? (p.ramGb * 1024)}MB RAM | ${p.cpuPercent ?? (p.vcpu * 100)}% CPU | ${p.storageGb}GB Disk`;
        return `${statusEmoji} **${p.name}** (\`${p.id}\`)\n   💰 **₹${p.priceInr} / $${p.priceUsd}** • ${specs}\n   Order: \`${p.displayOrder}\` • Status: \`${p.isActive ? "Active" : "Disabled"}\`\n`;
      });

  const embed = new EmbedBuilder()
    .setColor(isVps ? 0x5865f2 : 0x57f287)
    .setTitle(`⚙️ Admin Catalog — ${isVps ? "🖥️ VPS Plans" : "🎮 Minecraft Plans"}`)
    .setDescription(
      `Manage ${isVps ? "Linux VPS" : "Minecraft Game Server"} catalog plans in PostgreSQL database.\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        lines.join("\n")
    )
    .setFooter({ text: "Changes apply immediately to new orders." })
    .setTimestamp();

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`admin_pricing:plan:add:${category}`).setLabel("Add Plan").setEmoji("➕").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`admin_pricing:plan:edit_select:${category}`).setLabel("Edit Plan").setEmoji("✏️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_pricing:plan:toggle_select:${category}`).setLabel("Enable/Disable").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_pricing:plan:archive_select:${category}`).setLabel("Archive Plan").setEmoji("📂").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("admin_pricing:main").setLabel("Back").setEmoji("↩️").setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [actionRow] };
}

/**
 * Render Select Menu to select a plan for Edit / Toggle / Archive
 */
export async function renderPlanSelectMenu(category: "vps" | "minecraft", action: "edit" | "toggle" | "archive") {
  const plans = await getPricingPlans(category, true);

  if (plans.length === 0) {
    return { content: `❌ No ${category} plans found to ${action}.`, ephemeral: true };
  }

  const options = plans.map((p) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${p.name} — ₹${p.priceInr} / $${p.priceUsd}`)
      .setDescription(`${p.ramGb}GB RAM • ${p.vcpu} vCore • ${p.storageGb}GB Disk • (${p.isActive ? "Active" : "Disabled"})`)
      .setValue(`admin_pricing:plan_action:${action}:${p.id}`)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(`admin_pricing:select_exec:${action}:${category}`)
    .setPlaceholder(`Select a ${category} plan to ${action}...`)
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`admin_pricing:category:${category}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );

  return { content: `Select a **${category.toUpperCase()}** plan to **${action.toUpperCase()}**:`, components: [row, backRow], flags: 64 };
}

/**
 * Builds Modal for Adding or Editing a Plan
 */
export function buildPlanModal(category: "vps" | "minecraft", existingPlan?: any): ModalBuilder {
  const isEdit = Boolean(existingPlan);
  const modalId = isEdit
    ? `admin_pricing:modal:edit:${existingPlan.id}`
    : `admin_pricing:modal:add:${category}`;

  const modal = new ModalBuilder().setCustomId(modalId).setTitle(isEdit ? `Edit ${existingPlan.name} Plan` : `Add New ${category.toUpperCase()} Plan`);

  const nameInput = new TextInputBuilder()
    .setCustomId("plan_name")
    .setLabel("Plan Name")
    .setStyle(TextInputStyle.Short)
    .setValue(existingPlan?.name ?? "")
    .setPlaceholder(category === "vps" ? "e.g. Nano" : "e.g. Starter")
    .setRequired(true);

  const priceInrInput = new TextInputBuilder()
    .setCustomId("price_inr")
    .setLabel("Price in INR (₹)")
    .setStyle(TextInputStyle.Short)
    .setValue(existingPlan ? String(existingPlan.priceInr) : "")
    .setPlaceholder("e.g. 129")
    .setRequired(true);

  const priceUsdInput = new TextInputBuilder()
    .setCustomId("price_usd")
    .setLabel("Price in USD ($)")
    .setStyle(TextInputStyle.Short)
    .setValue(existingPlan ? String(existingPlan.priceUsd) : "")
    .setPlaceholder("e.g. 1.50")
    .setRequired(true);

  let specsInput: TextInputBuilder;

  if (category === "vps") {
    specsInput = new TextInputBuilder()
      .setCustomId("vps_specs")
      .setLabel("Specs (RAM GB, vCPU, Storage GB)")
      .setStyle(TextInputStyle.Short)
      .setValue(existingPlan ? `${existingPlan.ramGb}, ${existingPlan.vcpu}, ${existingPlan.storageGb}` : "")
      .setPlaceholder("e.g. 8, 2, 80")
      .setRequired(true);
  } else {
    specsInput = new TextInputBuilder()
      .setCustomId("mc_specs")
      .setLabel("Specs (RAM MB, CPU %, Storage GB)")
      .setStyle(TextInputStyle.Short)
      .setValue(
        existingPlan
          ? `${existingPlan.memoryMb ?? existingPlan.ramGb * 1024}, ${existingPlan.cpuPercent ?? existingPlan.vcpu * 100}, ${existingPlan.storageGb}`
          : ""
      )
      .setPlaceholder("e.g. 4096, 150, 20")
      .setRequired(true);
  }

  const descInput = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Description / Display Order")
    .setStyle(TextInputStyle.Short)
    .setValue(existingPlan ? `${existingPlan.description ?? ""}` : "")
    .setPlaceholder("Optional description")
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(priceInrInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(priceUsdInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(specsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descInput)
  );

  return modal;
}

/**
 * Render Billing Options Admin View
 */
export async function renderBillingAdminDashboard() {
  const vpsBilling = await getBillingOptions("vps", true);
  const mcBilling = await getBillingOptions("minecraft", true);

  const formatOptions = (opts: any[]) =>
    opts.map((b) => `• **${b.months} Month${b.months === 1 ? "" : "s"}** (\`${b.displayName}\`) — Discount: **${b.discountPercent}%** [ID: \`${b.id}\`]`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🗓️ Admin Billing & Discount Options")
    .setDescription(
      "**VPS Billing Discounts:**\n" +
        formatOptions(vpsBilling) +
        "\n\n**Minecraft Billing Discounts:**\n" +
        formatOptions(mcBilling) +
        "\n\nTo update a discount, select the billing option below."
    )
    .setFooter({ text: "MysticServers Catalog Administration" })
    .setTimestamp();

  const allBilling = [...vpsBilling, ...mcBilling];
  const selectOptions = allBilling.map((b) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${b.category.toUpperCase()} — ${b.months} Months (${b.discountPercent}% off)`)
      .setValue(`admin_pricing:billing_edit_select:${b.id}`)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("admin_pricing:billing_select")
    .setPlaceholder("Select a billing option to edit discount...")
    .addOptions(selectOptions);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("admin_pricing:main").setLabel("Back").setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row, backRow] };
}

/**
 * Render Audit History View
 */
export async function renderAuditHistoryDashboard() {
  const logs = await getPricingAuditLogs(10);

  const lines = logs.length === 0
    ? ["*No audit logs found.*"]
    : logs.map((l) => {
        const dateStr = new Date(l.createdAt).toLocaleDateString("en-IN");
        return `• **${l.action.toUpperCase()}** on \`${l.entityType}:${l.entityId}\` by <@${l.administratorDiscordId}> [${dateStr}]`;
      });

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("📜 Pricing Audit Log History")
    .setDescription(lines.join("\n"))
    .setFooter({ text: "MysticServers Audit Log" })
    .setTimestamp();

  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("admin_pricing:main").setLabel("Back").setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [backRow] };
}
