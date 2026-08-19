import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

import {
  createDatabaseTicket,
  deleteDatabaseTicket,
  getOrCreateCustomer,
  recordTicketEvent,
  setTicketChannel,
} from "./ticketDatabase";

const ticketCategoryId =
  process.env.TICKET_CATEGORY_ID;

const supportRoleId =
  process.env.SUPPORT_ROLE_ID;

export interface TicketVPSDetails {
  location: "India" | "Singapore" | "Japan";

  planId: string;
  planName: string;

  priceInr: number;
  priceUsd: number;

  ramGb: number;
  storageGb: number;
  vcpu: number;

  fullRootAccess: boolean;
  instantDeployment: boolean;
  discordSupport: boolean;
  networkAllocation: string;

  cpuModels: string[];
}

export async function createTicket(
  guild: Guild,
  member: GuildMember,
  department: string,
  vpsDetails?: TicketVPSDetails
): Promise<TextChannel> {
  if (!ticketCategoryId) {
    throw new Error(
      "TICKET_CATEGORY_ID is missing from .env"
    );
  }

  if (!supportRoleId) {
    throw new Error(
      "SUPPORT_ROLE_ID is missing from .env"
    );
  }

  // ----------------------------------------------------------
  // Check existing ticket
  // ----------------------------------------------------------

  const existingTicket =
    guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildText &&
        channel.parentId === ticketCategoryId &&
        channel.topic?.includes(
          `ticket-owner:${member.id}`
        )
    );

  if (
    existingTicket &&
    existingTicket.type === ChannelType.GuildText
  ) {
    throw new Error(
      `You already have an open ticket: ${existingTicket}`
    );
  }

  // ----------------------------------------------------------
  // Customer
  // ----------------------------------------------------------

  const customer =
    await getOrCreateCustomer(
      member.user.id,
      member.user.username,
      member.displayName
    );

  // ----------------------------------------------------------
  // Database ticket
  // ----------------------------------------------------------

  const ticket =
    await createDatabaseTicket(
      customer.id,
      guild.id,
      department
        .toLowerCase()
        .replace(" support", "")
    );

  try {
    const ticketNumber =
      ticket.ticketNumber
        .toString()
        .padStart(6, "0");

    const safeUsername =
      member.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 20);

    // --------------------------------------------------------
    // Discord channel
    // --------------------------------------------------------

    const channel =
      await guild.channels.create({
        name:
          `ticket-${ticketNumber}-${safeUsername}`,

        type:
          ChannelType.GuildText,

        parent:
          ticketCategoryId,

        topic:
          `ticket-id:${ticket.id} ` +
          `ticket-number:${ticketNumber} ` +
          `ticket-owner:${member.id}`,

        permissionOverwrites: [
          {
            id:
              guild.roles.everyone.id,

            deny: [
              PermissionFlagsBits.ViewChannel,
            ],
          },

          {
            id:
              member.id,

            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          },

          {
            id:
              supportRoleId,

            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ManageMessages,
            ],
          },

          {
            id:
              guild.members.me!.id,

            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
        ],
      });

    // --------------------------------------------------------
    // Link Discord channel
    // --------------------------------------------------------

    await setTicketChannel(
      ticket.id,
      channel.id
    );

    // --------------------------------------------------------
    // Ticket event
    // --------------------------------------------------------

    await recordTicketEvent(
      ticket.id,
      "created",
      member.user.id,
      {
        department,
        channelId:
          channel.id,

        ...(vpsDetails
          ? {
              location:
                vpsDetails.location,

              planId:
                vpsDetails.planId,

              planName:
                vpsDetails.planName,

              priceInr:
                vpsDetails.priceInr,

              priceUsd:
                vpsDetails.priceUsd,

              ramGb:
                vpsDetails.ramGb,

              storageGb:
                vpsDetails.storageGb,

              vcpu:
                vpsDetails.vcpu,

              fullRootAccess:
                vpsDetails.fullRootAccess,

              instantDeployment:
                vpsDetails.instantDeployment,

              discordSupport:
                vpsDetails.discordSupport,

              networkAllocation:
                vpsDetails.networkAllocation,

              cpuModels:
                vpsDetails.cpuModels,
            }
          : {}),
      }
    );

    // --------------------------------------------------------
    // Controls
    // --------------------------------------------------------

    const controls =
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              "ticket:claim"
            )
            .setLabel("Claim")
            .setEmoji("👤")
            .setStyle(
              ButtonStyle.Primary
            ),

          ...(vpsDetails
            ? [
                new ButtonBuilder()
                  .setCustomId("vps:provision")
                  .setLabel("Provision VPS")
                  .setEmoji("🖥️")
                  .setStyle(ButtonStyle.Success),
              ]
            : []),

          new ButtonBuilder()
            .setCustomId(
              "ticket:close"
            )
            .setLabel("Close")
            .setEmoji("🔒")
            .setStyle(
              ButtonStyle.Danger
            )
        );

    // --------------------------------------------------------
    // Standard ticket
    // --------------------------------------------------------

    let description =
      `Welcome ${member}!\n\n` +
      `**Department:** ${department}\n` +
      `**Ticket:** #${ticketNumber}\n` +
      `**Status:** 🟢 Open\n\n` +
      "A member of our support team will assist you shortly.\n\n" +
      "Please provide all relevant information so we can resolve your request quickly.";

    // --------------------------------------------------------
    // VPS Sales ticket
    // --------------------------------------------------------

    if (vpsDetails) {
      const locationEmoji =
        vpsDetails.location === "India"
          ? "🇮🇳"
          : vpsDetails.location === "Singapore"
            ? "🇸🇬"
            : "🇯🇵";

      description =
        `Welcome ${member}!\n\n` +
        `**Department:** ${department}\n` +
        `**Ticket:** #${ticketNumber}\n` +
        `**Status:** 🟢 Open\n\n` +

        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🖥️ **VPS CONFIGURATION**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +

        `${locationEmoji} **Location:** ${vpsDetails.location}\n` +
        `📦 **Plan:** ${vpsDetails.planName}\n` +
        `💰 **Price:** ₹${vpsDetails.priceInr} / $${vpsDetails.priceUsd} per month\n\n` +

        `🧠 **RAM:** ${vpsDetails.ramGb} GB\n` +
        `💾 **Disk:** ${vpsDetails.storageGb} GB\n` +
        `⚡ **vCore:** ${vpsDetails.vcpu}\n\n` +

        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✨ **Included Features**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +

        `${vpsDetails.fullRootAccess ? "✅" : "❌"} Full Root Access\n` +
        `${vpsDetails.instantDeployment ? "✅" : "❌"} Instant Deployment\n` +
        `${vpsDetails.discordSupport ? "✅" : "❌"} Discord Support\n` +
        `🌐 Network: ${vpsDetails.networkAllocation}\n\n` +

        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚙️ **CPU Platform**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +

        vpsDetails.cpuModels
          .map(
            (cpu) =>
              `• ${cpu}`
          )
          .join("\n") +

        `\n\n━━━━━━━━━━━━━━━━━━━━\n\n` +

        "A member of our Sales Team will assist you shortly.";
    }

    // --------------------------------------------------------
    // Embed
    // --------------------------------------------------------

    const embed =
      new EmbedBuilder()
        .setTitle(
          `🎫 MysticServers Support • #${ticketNumber}`
        )
        .setDescription(
          description
        )
        .setThumbnail(
          member.user.displayAvatarURL({
            size: 256,
          })
        )
        .setFooter({
          text:
            "MysticServers Support",
        })
        .setTimestamp();

    await channel.send({
      content:
        `${member} <@&${supportRoleId}>`,

      embeds: [embed],

      components: [
        controls,
      ],
    });

    return channel;
  } catch (error) {
    // --------------------------------------------------------
    // Rollback DB ticket
    // --------------------------------------------------------

    try {
      await deleteDatabaseTicket(
        ticket.id
      );
    } catch (rollbackError) {
      console.error(
        "❌ Failed to roll back database ticket:",
        rollbackError
      );
    }

    throw error;
  }
}