import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Open the MysticServers support panel")
  .setDefaultMemberPermissions(
    PermissionFlagsBits.ManageGuild
  );

export function createTicketPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🎫 MysticServers Support")
    .setDescription(
      "Need help? Select the department that best matches your request.\n\n" +
        "🛒 **Sales** — VPS plans, pricing and pre-sales questions\n" +
        "🖥️ **Technical Support** — VPS and technical issues\n" +
        "💳 **Billing** — Payments, renewals and invoices\n" +
        "🌐 **VPS Support** — Existing VPS management issues\n" +
        "❓ **Other** — Anything else"
    )
    .setFooter({
      text: "MysticServers • Support",
    });

  const row =
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket:sales")
        .setLabel("Sales")
        .setEmoji("🛒")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("ticket:technical")
        .setLabel("Technical")
        .setEmoji("🖥️")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("ticket:billing")
        .setLabel("Billing")
        .setEmoji("💳")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("ticket:vps")
        .setLabel("VPS")
        .setEmoji("🌐")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("ticket:other")
        .setLabel("Other")
        .setEmoji("❓")
        .setStyle(ButtonStyle.Secondary)
    );

  return {
    embeds: [embed],
    components: [row],
  };
}