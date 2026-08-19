import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";

import {
  getCustomerHistory,
  CustomerHistoryTicket,
} from "../services/customerHistory";

const SUPPORT_ROLE_ID =
  process.env.SUPPORT_ROLE_ID;

function formatDate(
  date?: Date
): string {
  if (!date) {
    return "—";
  }

  return `<t:${Math.floor(
    date.getTime() / 1000
  )}:f>`;
}

function statusEmoji(
  status: string
): string {
  if (status === "open") {
    return "🟢";
  }

  if (status === "claimed") {
    return "🟡";
  }

  if (status === "closed") {
    return "🔴";
  }

  return "⚪";
}

function ticketSummary(
  ticket: CustomerHistoryTicket
): string {
  const number =
    String(ticket.ticketNumber).padStart(
      6,
      "0"
    );

  const status =
    `${statusEmoji(ticket.status)} ${ticket.status}`;

  const base =
    `**#${number}** • ${ticket.department} • ${status}`;

  if (
    ticket.planName &&
    ticket.location
  ) {
    return (
      `${base}\n` +
      `🖥️ ${ticket.planName} • ${ticket.location} • ` +
      `${ticket.ramGb ?? "?"}GB RAM • ` +
      `${ticket.storageGb ?? "?"}GB Disk • ` +
      `${ticket.vcpu ?? "?"} vCore\n` +
      `📅 ${formatDate(ticket.createdAt)}`
    );
  }

  return (
    `${base}\n` +
    `📅 ${formatDate(ticket.createdAt)}`
  );
}

export async function handleCustomerHistory(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (
    interaction.commandName !== "history"
  ) {
    return;
  }

  const member =
    interaction.guild
      ? await interaction.guild.members
          .fetch(interaction.user.id)
          .catch(() => null)
      : null;

  const isAdministrator =
    Boolean(
      member?.permissions.has(
        PermissionFlagsBits.Administrator
      )
    );

  const isSupport =
    Boolean(
      SUPPORT_ROLE_ID &&
      member?.roles.cache.has(
        SUPPORT_ROLE_ID
      )
    );

  if (!isAdministrator && !isSupport) {
    await interaction.reply({
      content:
        "❌ This command is only available to the MysticServers Support Team.",
      flags: 64,
    });

    return;
  }

  const user =
    interaction.options.getUser(
      "user",
      true
    );

  await interaction.deferReply({
    flags: 64,
  });

  try {
    const history =
      await getCustomerHistory(
        user.id
      );

    if (!history) {
      await interaction.editReply({
        content:
          `❌ No MysticServers customer record exists for ${user}.`,
      });

      return;
    }

    const tickets =
      history.tickets;

    const openCount =
      tickets.filter(
        (ticket) =>
          ticket.status === "open"
      ).length;

    const claimedCount =
      tickets.filter(
        (ticket) =>
          ticket.status === "claimed"
      ).length;

    const closedCount =
      tickets.filter(
        (ticket) =>
          ticket.status === "closed"
      ).length;

    const displayName =
      history.customer.displayName ||
      history.customer.username ||
      user.username;

    const recentTickets =
      tickets
        .slice(0, 10)
        .map(ticketSummary)
        .join("\n\n");

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(
          `👤 Customer History • ${displayName}`
        )
        .setThumbnail(
          user.displayAvatarURL({
            size: 256,
          })
        )
        .setDescription(
          `${user}\n` +
          `Discord ID: \`${user.id}\``
        )
        .addFields(
          {
            name: "📊 Ticket Summary",
            value:
              `**Total:** ${tickets.length}\n` +
              `🟢 Open: **${openCount}**\n` +
              `🟡 Claimed: **${claimedCount}**\n` +
              `🔴 Closed: **${closedCount}**`,
            inline: true,
          },
          {
            name: "🎫 Recent Tickets",
            value:
              recentTickets ||
              "No tickets found.",
            inline: false,
          }
        )
        .setFooter({
          text:
            tickets.length > 10
              ? "Showing the 10 most recent tickets"
              : "MysticServers • Customer History",
        })
        .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
    });
  } catch (error) {
    console.error(
      "❌ Failed to load customer history:",
      error
    );

    await interaction.editReply({
      content:
        "❌ Failed to load customer history from PostgreSQL.",
      embeds: [],
    });
  }
}
