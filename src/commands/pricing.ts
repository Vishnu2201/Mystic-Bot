import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import {
  getPricingPlanById,
  renderVpsPricingPanel,
  getHostingNodeById,
  PricingLocation,
} from "../services/pricingService";

export { PricingLocation };

export const CPU_MODELS = [
  "AMD EPYC Turin @ 2.396GHz",
  "AMD EPYC 9575F @ 3.295GHz",
];

export const pricingCommand = new SlashCommandBuilder()
  .setName("pricing")
  .setDescription("View MysticServers VPS pricing")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function createPricingPanel(nodeId?: string) {
  return renderVpsPricingPanel(nodeId);
}

// ============================================================
// Selected Plan Details
// ============================================================

export async function createPlanDetails(planId: string, nodeId?: string) {
  const plan = await getPricingPlanById(planId);
  if (!plan) {
    throw new Error("VPS plan no longer exists.");
  }

  const node = nodeId ? await getHostingNodeById(nodeId) : null;
  const flag = node?.countryFlag || "🇩🇪";
  const locationLabel = node ? `${node.locationName} (${node.nodeName})` : "Germany";
  const backTarget = node?.id || "default";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🖥️ MysticServers — ${plan.name}`)
    .setDescription(
      `${flag} **${locationLabel} VPS**\n\n` +
        `💰 **₹${plan.priceInr} / $${plan.priceUsd} per month**\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        `🧠 **RAM:** ${plan.ramGb} GB\n` +
        `💾 **Disk:** ${plan.storageGb} GB\n` +
        `⚡ **vCore:** ${plan.vcpu}\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "✨ **Included**\n\n" +
        "⚡ Full Root Access\n" +
        "🚀 Instant Deployment\n" +
        "💬 Discord Support\n" +
        "🌐 IPv4/IPv6 availability depends on provider and location\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "⚙️ **CPU Platforms**\n" +
        "• AMD EPYC Turin @ 2.396GHz\n" +
        "• AMD EPYC 9575F @ 3.295GHz\n\n" +
        "Ready to continue?"
    )
    .setFooter({
      text: "MysticServers • Only you can see this",
    });

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pricing:back:${backTarget}`)
      .setLabel("Back to Plans")
      .setEmoji("↩️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`pricing:create:${backTarget}:${plan.id}`)
      .setLabel("Create Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embed,
    components: [buttons],
    plan,
    node,
  };
}