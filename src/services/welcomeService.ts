import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  TextChannel,
} from "discord.js";

export async function sendWelcomeMessage(
  member: GuildMember
): Promise<void> {
  const welcomeChannel =
    member.guild.channels.cache.find(
      (channel) =>
        channel.isTextBased() &&
        channel.name === "👋・welcome"
    );

  if (
    !welcomeChannel ||
    !(welcomeChannel instanceof TextChannel)
  ) {
    console.warn(
      `⚠️ Welcome channel not found in ${member.guild.name}`
    );

    return;
  }

  // ==========================================================
  // Welcome Embed
  // ==========================================================

  const embed =
    new EmbedBuilder()
      .setTitle(
        "🌌 Welcome to MysticServers"
      )
      .setDescription(
        `Welcome ${member}!\n\n` +
        "We're glad to have you here.\n\n" +
        "Need a VPS or assistance from our team? " +
        "Use the options below to get started."
      )
      .setThumbnail(
        member.user.displayAvatarURL({
          size: 256,
        })
      )
      .setFooter({
        text:
          "MysticServers • Reliable Infrastructure",
      })
      .setTimestamp();

  // ==========================================================
  // Customer Buttons
  // ==========================================================

  const buttons =
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "ticket:create"
          )
          .setLabel(
            "Create Ticket"
          )
          .setEmoji("🎫")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "pricing:open"
          )
          .setLabel(
            "Pricing"
          )
          .setEmoji("💰")
          .setStyle(
            ButtonStyle.Secondary
          )
      );

  // ==========================================================
  // Send Welcome Message
  // ==========================================================

  await welcomeChannel.send({
    content:
      `Welcome to MysticServers, ${member}! 🎉`,

    embeds: [
      embed,
    ],

    components: [
      buttons,
    ],
  });
}