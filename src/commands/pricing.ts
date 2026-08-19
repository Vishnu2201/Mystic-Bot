import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

import {
  getPricingPlans,
  getPricingPlanById,
} from "../services/pricingService";

export type PricingLocation =
  | "India"
  | "Singapore"
  | "Japan";

export const pricingCommand =
  new SlashCommandBuilder()
    .setName("pricing")
    .setDescription(
      "View MysticServers VPS pricing"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    );

export const CPU_MODELS = [
  "AMD EPYC Turin @ 2.396GHz",
  "AMD EPYC 9575F @ 3.295GHz",
];

function locationEmoji(
  location: PricingLocation
): string {
  if (location === "India") {
    return "🇮🇳";
  }

  if (location === "Singapore") {
    return "🇸🇬";
  }

  return "🇯🇵";
}

// ============================================================
// Main Pricing Panel
// ============================================================

export async function createPricingPanel(
  location: PricingLocation = "India"
) {
  const plans =
    await getPricingPlans();

  const embed =
    new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(
        "🌐 MysticServers"
      )
      .setDescription(
        "**VPS HOSTING**\n\n" +

        "Reliable VPS hosting and infrastructure " +
        "built for developers, businesses and projects.\n\n" +

        `📍 **Location:** ${locationEmoji(location)} ${location}\n\n` +

        "━━━━━━━━━━━━━━━━━━━━\n\n" +

        "**VPS PLANS**\n\n" +

        plans
          .map(
            (plan) =>
              `**₹${plan.priceInr} / $${plan.priceUsd}** → ` +
              `${plan.ramGb}GB RAM | ` +
              `${plan.storageGb}GB Disk | ` +
              `${plan.vcpu} vCore`
          )
          .join("\n") +

        "\n\n━━━━━━━━━━━━━━━━━━━━\n\n" +

        "✨ **Included With Every VPS**\n\n" +

        "⚡ Full Root Access\n" +
        "🚀 Instant Deployment\n" +
        "💬 Discord Support\n" +
        "🌐 IPv4/IPv6 availability depends on provider and location\n\n" +

        "🌍 **Available Locations**\n" +
        "🇮🇳 India • 🇸🇬 Singapore • 🇯🇵 Japan\n\n" +

        "⚙️ **CPU Platforms**\n" +
        "• AMD EPYC Turin @ 2.396GHz\n" +
        "• AMD EPYC 9575F @ 3.295GHz\n\n" +

        "Select a VPS plan below to continue."
      )
      .setFooter({
        text:
          "MysticServers • Only you can see this",
      });

  const options =
    plans.map(
      (plan) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(
            `${plan.name} • ₹${plan.priceInr} / $${plan.priceUsd}`
          )
          .setDescription(
            `${plan.ramGb}GB RAM • ${plan.storageGb}GB Disk • ${plan.vcpu} vCore`
          )
          .setEmoji("🖥️")
          .setValue(
            `pricing:plan:${location}:${plan.id}`
          )
    );

  const select =
    new StringSelectMenuBuilder()
      .setCustomId(
        `pricing:plan:${location}`
      )
      .setPlaceholder(
        "Select a VPS plan"
      )
      .addOptions(options);

  const selectRow =
    new ActionRowBuilder<StringSelectMenuBuilder>()
      .addComponents(select);

  const locationRow =
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "pricing:location:India"
          )
          .setLabel("India")
          .setEmoji("🇮🇳")
          .setStyle(
            location === "India"
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "pricing:location:Singapore"
          )
          .setLabel("Singapore")
          .setEmoji("🇸🇬")
          .setStyle(
            location === "Singapore"
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "pricing:location:Japan"
          )
          .setLabel("Japan")
          .setEmoji("🇯🇵")
          .setStyle(
            location === "Japan"
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary
          )
      );

  return {
    embeds: [embed],
    components: [
      selectRow,
      locationRow,
    ],
  };
}

// ============================================================
// Selected Plan Details
// ============================================================

export async function createPlanDetails(
  planId: string,
  location: PricingLocation
) {
  const plan =
    await getPricingPlanById(
      planId
    );

  if (!plan) {
    throw new Error(
      "VPS plan no longer exists."
    );
  }

  const embed =
    new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(
        `🖥️ MysticServers — ${plan.name}`
      )
      .setDescription(
        `${locationEmoji(location)} **${location} VPS**\n\n` +

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
        text:
          "MysticServers • Only you can see this",
      });

  const buttons =
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `pricing:back:${location}`
          )
          .setLabel(
            "Back to Plans"
          )
          .setEmoji("↩️")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `pricing:create:${location}:${plan.id}`
          )
          .setLabel(
            "Create Ticket"
          )
          .setEmoji("🎫")
          .setStyle(
            ButtonStyle.Primary
          )
      );

  return {
    embed,
    components: [
      buttons,
    ],
    plan,
  };
}