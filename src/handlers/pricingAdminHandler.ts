import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  getDisplaySettings,
  updateDisplaySettings,
  renderVpsPricingPanel,
  renderMinecraftPricingPanel,
  getHostingNodes,
  getHostingNodeById,
  createHostingNode,
  updateHostingNode,
  toggleHostingNodeActive,
  archiveHostingNode,
  HostingNode,
} from "../services/pricingService";

/**
 * Verifies that the user interacting with admin pricing has Administrator permissions.
 */
export function checkAdminAuth(interaction: Interaction): boolean {
  if (!interaction.guild || !interaction.member) return false;
  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (!member) return false;

  const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);
  return isAdministrator;
}

/**
 * Main dashboard embed and buttons for /admin-pricing
 */
export async function renderAdminPricingMainDashboard() {
  const vpsPlans = await getPricingPlans("vps", true);
  const mcPlans = await getPricingPlans("minecraft", true);
  const nodes = await getHostingNodes(undefined, true);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("⚙️ MYSTIC SERVERS — PRICING CATALOG CONTROL PANEL")
    .setDescription(
      "Welcome Administrator! Select a product category below to manage live pricing, plan specifications, infrastructure nodes, presentation text, and availability.\n\n" +
        `🖥️ **VPS Catalog:** ${vpsPlans.length} plans (${vpsPlans.filter((p) => p.isActive).length} active)\n` +
        `🎮 **Minecraft Catalog:** ${mcPlans.length} plans (${mcPlans.filter((p) => p.isActive).length} active)\n` +
        `🌍 **Hosting Nodes:** ${nodes.length} nodes (${nodes.filter((n) => n.isActive).length} active)\n` +
        "📝 **Display Settings:** Fully editable titles, subtitles, locations & features\n" +
        "🗓️ **Billing Discounts:** 1m, 3m, 6m, 12m rules\n\n" +
        "Select an option below to proceed."
    )
    .setFooter({ text: "MysticServers Catalog Administration" })
    .setTimestamp();

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("admin_pricing:category:vps").setLabel("VPS Plans").setEmoji("🖥️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_pricing:category:minecraft").setLabel("Minecraft Plans").setEmoji("🎮").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_pricing:category:nodes").setLabel("Hosting Nodes").setEmoji("🌍").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("admin_pricing:category:display_select").setLabel("Display Settings").setEmoji("📝").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("admin_pricing:category:billing").setLabel("Billing Discounts").setEmoji("🗓️").setStyle(ButtonStyle.Secondary)
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
    .setFooter({ text: "Changes apply immediately to public displays." })
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
 * Hosting Nodes Admin Management Dashboard
 */
export async function renderAdminNodesDashboard() {
  const nodes = await getHostingNodes(undefined, true);

  const lines = nodes.length === 0
    ? ["*No hosting nodes configured in database.*"]
    : nodes.map((n) => {
        const statusEmoji = n.isActive ? "🟢 Active" : "🔴 Disabled";
        return `${n.countryFlag} **${n.displayName}** (\`${n.id}\`)\n   📍 Location: \`${n.locationName}\` • Node: \`${n.nodeName}\` • Host: \`${n.hostname}\`\n   Category: \`${n.category}\` • Order: \`${n.displayOrder}\` • Status: **${statusEmoji}**\n`;
      });

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("🌍 Admin Hosting Nodes — Infrastructure Source of Truth")
    .setDescription(
      "Manage live hosting nodes and location choices for VPS & Minecraft hosting.\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        lines.join("\n")
    )
    .setFooter({ text: "Customer location selectors update dynamically from active nodes." })
    .setTimestamp();

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("admin_pricing:node:add").setLabel("Add Node").setEmoji("➕").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("admin_pricing:node:edit_select").setLabel("Edit Node").setEmoji("✏️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("admin_pricing:node:toggle_select").setLabel("Enable/Disable").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("admin_pricing:node:archive_select").setLabel("Archive Node").setEmoji("📂").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("admin_pricing:main").setLabel("Back").setEmoji("↩️").setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [actionRow] };
}

/**
 * Render Select Menu to select a Hosting Node for Edit / Toggle / Archive
 */
export async function renderNodeSelectMenu(action: "edit" | "toggle" | "archive") {
  const nodes = await getHostingNodes(undefined, true);

  if (nodes.length === 0) {
    return { content: `❌ No hosting nodes found to ${action}.`, ephemeral: true };
  }

  const options = nodes.map((n) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${n.countryFlag} ${n.displayName}`)
      .setDescription(`Location: ${n.locationName} • Node: ${n.nodeName} • (${n.isActive ? "Active" : "Disabled"})`)
      .setValue(`admin_pricing:node_action:${action}:${n.id}`)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(`admin_pricing:node_select_exec:${action}`)
    .setPlaceholder(`Select a hosting node to ${action}...`)
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("admin_pricing:category:nodes").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );

  return { content: `Select a **HOSTING NODE** to **${action.toUpperCase()}**:`, components: [row, backRow], flags: 64 };
}

/**
 * Builds Modal for Adding or Editing a Hosting Node
 */
export function buildNodeModal(existingNode?: HostingNode): ModalBuilder {
  const isEdit = Boolean(existingNode);
  const modalId = isEdit
    ? `admin_pricing:modal:node_edit:${existingNode!.id}`
    : "admin_pricing:modal:node_add";

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(isEdit ? `Edit Node: ${existingNode!.nodeName}` : "Add New Hosting Node");

  const nameInput = new TextInputBuilder()
    .setCustomId("display_name")
    .setLabel("Display Name (e.g. Germany — DE-01)")
    .setStyle(TextInputStyle.Short)
    .setValue(existingNode?.displayName ?? "")
    .setPlaceholder("e.g. Germany — DE-01")
    .setRequired(true);

  const locationInput = new TextInputBuilder()
    .setCustomId("location_details")
    .setLabel("Country Code, Flag Emoji, Location Name")
    .setStyle(TextInputStyle.Short)
    .setValue(existingNode ? `${existingNode.countryCode}, ${existingNode.countryFlag}, ${existingNode.locationName}` : "DE, 🇩🇪, Germany")
    .setPlaceholder("e.g. DE, 🇩🇪, Germany")
    .setRequired(true);

  const nodeNameInput = new TextInputBuilder()
    .setCustomId("node_name")
    .setLabel("Node Name (e.g. DE-01)")
    .setStyle(TextInputStyle.Short)
    .setValue(existingNode?.nodeName ?? "")
    .setPlaceholder("e.g. DE-01")
    .setRequired(true);

  const hostInput = new TextInputBuilder()
    .setCustomId("hostname")
    .setLabel("Public Hostname / FQDN")
    .setStyle(TextInputStyle.Short)
    .setValue(existingNode?.hostname ?? "")
    .setPlaceholder("e.g. minecraft.mysticservers.com")
    .setRequired(true);

  const catInput = new TextInputBuilder()
    .setCustomId("category_order")
    .setLabel("Category (vps/minecraft/both), Display Order")
    .setStyle(TextInputStyle.Short)
    .setValue(existingNode ? `${existingNode.category}, ${existingNode.displayOrder}` : "both, 1")
    .setPlaceholder("e.g. both, 1")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(locationInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(nodeNameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(hostInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(catInput)
  );

  return modal;
}

/**
 * Display Settings Management Dashboard per Category
 */
export async function renderAdminDisplaySettingsDashboard(category: "vps" | "minecraft") {
  const settings = await getDisplaySettings(category);
  const isVps = category === "vps";

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`📝 Presentation Settings — ${isVps ? "🖥️ VPS Hosting" : "🎮 Minecraft Hosting"}`)
    .setDescription(
      `Configure the public presentation text for **${category.toUpperCase()}** pricing messages.\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        `📌 **Title:** \`${settings.title}\`\n` +
        `🏷️ **Subtitle:** \`${settings.subtitle ?? "None"}\`\n` +
        `✨ **Features Count:** ${settings.features.length} item(s)\n` +
        `📜 **Footer:** \`${settings.footer ?? "None"}\`\n\n` +
        "Select an option below to edit presentation fields or preview live rendering."
    )
    .setFooter({ text: "MysticServers Presentation Control Panel" })
    .setTimestamp();

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`admin_pricing:display:edit_text:${category}`).setLabel("Text & Titles").setEmoji("✏️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_pricing:display:edit_features:${category}`).setLabel("Feature List").setEmoji("✨").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_pricing:display:preview:${category}`).setLabel("Preview Live").setEmoji("👁️").setStyle(ButtonStyle.Success),
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
