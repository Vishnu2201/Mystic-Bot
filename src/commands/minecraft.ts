import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

import { getMinecraftPlans, getMinecraftPlanById } from "../config/minecraftPlans";

export const minecraftCommand = new SlashCommandBuilder()
  .setName("minecraft")
  .setDescription("View and manage Minecraft hosting servers and plans")
  .addSubcommand((subcommand) =>
    subcommand.setName("plans").setDescription("View available Minecraft hosting plans")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("servers").setDescription("View your active Minecraft hosting servers")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("info")
      .setDescription("View Minecraft hosting information for a customer (Staff only)")
      .addUserOption((option) =>
        option.setName("user").setDescription("The customer to inspect").setRequired(true)
      )
  );

export async function createMinecraftPricingPanel() {
  const plans = getMinecraftPlans();

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("🎮 MysticServers — Minecraft Hosting")
    .setDescription(
      "**HIGH PERFORMANCE MINECRAFT HOSTING**\n\n" +
        "Instant deployment Paper/Java Minecraft servers powered by high-frequency CPUs.\n\n" +
        "📍 **Location:** 🇮🇳 India Node LXC-01\n" +
        "🌐 **Hostname:** `minecraft.mysticservers.com`\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "**AVAILABLE PLANS**\n\n" +
        plans
          .map(
            (plan) =>
              `**${plan.name}** — **₹${plan.priceInr} / $${plan.priceUsd} per month**\n` +
              `🧠 ${plan.ramGb} GB RAM • ⚡ ${plan.cpuPercent}% CPU • 💾 ${plan.storageGb} GB Disk\n`
          )
          .join("\n") +
        "\n━━━━━━━━━━━━━━━━━━━━\n\n" +
        "✨ **Included With Every Server**\n\n" +
        "⚡ Paper / Java 25 Ready\n" +
        "🚀 Instant Automatic Provisioning\n" +
        "🎛️ Full Pterodactyl Panel Control\n" +
        "💬 24/7 Discord Support\n\n" +
        "Select a plan below to create a purchase ticket."
    )
    .setFooter({
      text: "MysticServers • Minecraft Hosting",
    });

  const options = plans.map((plan) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${plan.name} • ₹${plan.priceInr}/mo ($${plan.priceUsd})`)
      .setDescription(`${plan.ramGb}GB RAM • ${plan.cpuPercent}% CPU • ${plan.storageGb}GB Disk`)
      .setEmoji("🎮")
      .setValue(`minecraft:plan:${plan.id}`)
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

export async function createMinecraftPlanDetails(planId: string, billingMonths: number = 1) {
  const plan = getMinecraftPlanById(planId);
  if (!plan) {
    throw new Error("Minecraft plan no longer exists.");
  }

  const duration = [1, 3, 6, 12].includes(billingMonths) ? billingMonths : 1;
  const totalPriceInr = plan.priceInr * duration;
  const totalPriceUsd = plan.priceUsd * duration;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🎮 MysticServers — ${plan.name} Minecraft Plan`)
    .setDescription(
      `🗓️ **Billing Duration:** ${duration} month${duration === 1 ? "" : "s"}\n` +
      `💳 **Monthly Price:** ₹${plan.priceInr} / $${plan.priceUsd} per month\n` +
      `💰 **Total Price:** ₹${totalPriceInr} / $${totalPriceUsd}\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        `🧠 **RAM:** ${plan.ramGb} GB (${plan.ramMb} MB)\n` +
        `⚡ **CPU:** ${plan.cpuPercent}% (Pterodactyl limit)\n` +
        `💾 **Disk:** ${plan.storageGb} GB (${plan.storageMb} MB)\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "✨ **Included Features**\n\n" +
        "⚡ High-frequency AMD EPYC Core\n" +
        "🌐 Customer Hostname: `minecraft.mysticservers.com`\n" +
        "🎛️ Pterodactyl Web Panel & SFTP Access\n" +
        "🚀 Instant Provisioning upon Payment\n\n" +
        "Select duration below, then click Create Ticket."
    )
    .setFooter({
      text: "MysticServers • Minecraft Hosting",
    });

  const durationOptions = [
    new StringSelectMenuOptionBuilder()
      .setLabel(`1 Month — ₹${plan.priceInr} / $${plan.priceUsd}`)
      .setValue(`minecraft:duration:${plan.id}:1`)
      .setDefault(duration === 1),
    new StringSelectMenuOptionBuilder()
      .setLabel(`3 Months — ₹${plan.priceInr * 3} / $${plan.priceUsd * 3}`)
      .setValue(`minecraft:duration:${plan.id}:3`)
      .setDefault(duration === 3),
    new StringSelectMenuOptionBuilder()
      .setLabel(`6 Months — ₹${plan.priceInr * 6} / $${plan.priceUsd * 6}`)
      .setValue(`minecraft:duration:${plan.id}:6`)
      .setDefault(duration === 6),
    new StringSelectMenuOptionBuilder()
      .setLabel(`12 Months — ₹${plan.priceInr * 12} / $${plan.priceUsd * 12}`)
      .setValue(`minecraft:duration:${plan.id}:12`)
      .setDefault(duration === 12),
  ];

  const durationSelect = new StringSelectMenuBuilder()
    .setCustomId(`minecraft:duration:select:${plan.id}`)
    .setPlaceholder("Choose Billing Duration")
    .addOptions(durationOptions);

  const durationRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(durationSelect);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("minecraft:back:plans")
      .setLabel("Back to Plans")
      .setEmoji("↩️")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`minecraft:create_ticket:${plan.id}:${duration}`)
      .setLabel("Create Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embed,
    components: [durationRow, buttons],
    plan,
    duration,
  };
}
