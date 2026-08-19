import {
  ChatInputCommandInteraction,
  Interaction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonInteraction,
  ChannelType,
  TextChannel,
  Message,
  User,
} from "discord.js";

import fs from "fs/promises";
import path from "path";

import {
  createTicket,
} from "../services/ticketService";

import {
  getPricingPlanById,
} from "../services/pricingService";

import {
  createTicketPanel,
} from "../commands/ticket";

import {
  createPricingPanel,
  createPlanDetails,
  PricingLocation,
  CPU_MODELS,
} from "../commands/pricing";

import {
  getTicketById,
  getCustomerById,
  getTicketCreatedMetadata,
  claimDatabaseTicket,
  closeDatabaseTicket,
  recordTicketEvent,
} from "../services/ticketDatabase";

import {
  createVpsInstance,
  getVpsByTicketId,
  getVpsByNumber,
  renewVps,
} from "../services/vpsDatabase";

import {
  refreshVpsManagementDashboard,
} from "../services/vpsLifecycle";

import {
  getModerationUserState,
  getRecentModerationEvents,
  setModerationWhitelist,
  removeModerationWhitelist,
  getModerationWhitelist,
} from "../services/moderationDatabase";

const departmentNames: Record<string, string> = {
  sales: "Sales",
  technical: "Technical Support",
  billing: "Billing",
  vps: "VPS Support",
  other: "Other",
};

// ============================================================
// Main Interaction Handler
// ============================================================

export async function handleInteraction(
  interaction: Interaction
): Promise<void> {
  try {
    // --------------------------------------------------------
    // Slash Commands
    // --------------------------------------------------------

    if (
      interaction.isChatInputCommand()
    ) {
      await handleSlashCommand(
        interaction
      );

      return;
    }

    // --------------------------------------------------------
    // VPS Billing Cycle Select Menu
    // --------------------------------------------------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("vps:billing:")
    ) {
      await handleVpsBillingSelect(interaction);
      return;
    }

    // --------------------------------------------------------
    // Pricing Select Menu
    // --------------------------------------------------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith(
        "pricing:plan:"
      )
    ) {
      await handlePricingPlan(
        interaction
      );

      return;
    }

    // --------------------------------------------------------
    // Modal submissions
    // --------------------------------------------------------

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("vps:provision:network:")) {
        await handleVpsNetworkModal(interaction);
        return;
      }

      if (interaction.customId.startsWith("vps:provision:access:")) {
        await handleVpsAccessModal(interaction);
        return;
      }
    }

    // --------------------------------------------------------
    // Buttons
    // --------------------------------------------------------

    if (
      interaction.isButton()
    ) {
      if (
        interaction.customId.startsWith(
          "ticket:"
        )
      ) {
        await handleTicketButton(
          interaction
        );

        return;
      }

      if (interaction.customId.startsWith("vps:")) {
        await handleVpsButton(interaction);
        return;
      }

      if (
        interaction.customId.startsWith(
          "pricing:"
        )
      ) {
        await handlePricingButton(
          interaction
        );

        return;
      }
    }

  } catch (error) {
    console.error(
      "❌ Interaction error:",
      error
    );

    if (
      !interaction.isRepliable()
    ) {
      return;
    }

    const message =
      "❌ Something went wrong while processing your request.";

    if (
      interaction.replied ||
      interaction.deferred
    ) {
      await interaction
        .followUp({
          content: message,
          flags: 64,
        })
        .catch(() => {});
    } else {
      await interaction
        .reply({
          content: message,
          flags: 64,
        })
        .catch(() => {});
    }
  }
}

// ============================================================
// Slash Commands
// ============================================================

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const supportRoleId =
    process.env.SUPPORT_ROLE_ID;

  const member =
    interaction.guild
      ? await interaction.guild.members
          .fetch(
            interaction.user.id
          )
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
      supportRoleId &&
      member?.roles.cache.has(
        supportRoleId
      )
    );

  const isStaff =
    isAdministrator ||
    isSupport;

  // ==========================================================
  // /ticket
  // ==========================================================

  if (
    interaction.commandName ===
    "ticket"
  ) {
    if (!isStaff) {
      await interaction.reply({
        content:
          "❌ This command is only available to the MysticServers Support Team.",
        flags: 64,
      });

      return;
    }

    await interaction.reply(
      createTicketPanel()
    );

    return;
  }

  // ==========================================================
  // /pricing
  // ==========================================================

  if (
    interaction.commandName ===
    "pricing"
  ) {
    if (!isStaff) {
      await interaction.reply({
        content:
          "❌ This command is only available to the MysticServers Support Team.",
        flags: 64,
      });

      return;
    }

    /*
     * PUBLIC pricing message.
     */

    await interaction.reply({
      ...await createPricingPanel(
        "India"
      ),
    });

    return;
  }

  if (interaction.commandName === "vps") {
    await handleVpsCommand(interaction, isStaff);
    return;
  }

  if (interaction.commandName === "mod") {
    await handleModCommand(interaction, isStaff);
    return;
  }
}

// ============================================================
// Moderation Commands
// ============================================================

async function handleModCommand(
  interaction: ChatInputCommandInteraction,
  isStaff: boolean
): Promise<void> {
  if (!isStaff) {
    await interaction.reply({
      content: "❌ This command is only available to the MysticServers Support Team.",
      flags: 64,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const group = interaction.options.getSubcommandGroup(false);

  if (subcommand === "user" && !group) {
    const user = interaction.options.getUser("member", true);
    await showModerationProfile(interaction, user);
    return;
  }

  if (group === "whitelist") {
    const user = subcommand === "list"
      ? null
      : interaction.options.getUser("member", true);

    if (subcommand === "add" && user) {
      await setModerationWhitelist(interaction.guildId!, user.id, interaction.user.id);
      await interaction.reply({
        content: `✅ ${user} has been added to the MysticServers Guard whitelist. Automatic moderation will ignore this member.`,
        flags: 64,
      });
      return;
    }

    if (subcommand === "remove" && user) {
      const removed = await removeModerationWhitelist(interaction.guildId!, user.id);
      await interaction.reply({
        content: removed
          ? `✅ ${user} has been removed from the MysticServers Guard whitelist.`
          : `ℹ️ ${user} was not on the MysticServers Guard whitelist.`,
        flags: 64,
      });
      return;
    }

    if (subcommand === "list") {
      const ids = await getModerationWhitelist(interaction.guildId!);
      await interaction.reply({
        content: ids.length === 0
          ? "ℹ️ The MysticServers Guard whitelist is currently empty."
          : `🛡️ **MysticServers Guard Whitelist**\n\n${ids.map((id) => `• <@${id}> (${id})`).join("\n")}`,
        flags: 64,
      });
      return;
    }
  }
}

async function showModerationProfile(
  interaction: ChatInputCommandInteraction,
  user: User
): Promise<void> {
  await interaction.deferReply({ flags: 64 });

  try {
    const [state, events] = await Promise.all([
      getModerationUserState(interaction.guildId!, user.id),
      getRecentModerationEvents(interaction.guildId!, user.id, 10),
    ]);

    const member = interaction.guild
      ? await interaction.guild.members.fetch(user.id).catch(() => null)
      : null;

    const history = events.length === 0
      ? "No moderation events recorded."
      : events.map((event) => {
          const time = `<t:${Math.floor(new Date(event.createdAt).getTime() / 1000)}:R>`;
          return `• ${time} — **${event.matchedRule}** (${event.severity}) → ${event.action}`;
        }).join("\n");

    const timeoutText = member?.communicationDisabledUntilTimestamp
      ? `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`
      : "Not timed out";

    const embed = new EmbedBuilder()
      .setTitle("🛡️ MysticServers Guard — Moderation Profile")
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "👤 User", value: `${user} (${user.id})`, inline: false },
        { name: "⚠️ Warnings", value: String(state?.warningCount ?? 0), inline: true },
        { name: "🚨 Violations", value: String(state?.violationCount ?? 0), inline: true },
        { name: "🔇 Timeout", value: timeoutText, inline: true },
        { name: "📜 Recent History", value: history.slice(0, 1024), inline: false },
      )
      .setFooter({ text: "MysticServers Guard • Staff only" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("❌ Failed to load moderation profile:", error);
    await interaction.editReply({
      content: "❌ Failed to load the moderation profile. Check the bot console for details.",
    });
  }
}

// ============================================================
// VPS Lifecycle Commands
// ============================================================

async function handleVpsCommand(
  interaction: ChatInputCommandInteraction,
  isStaff: boolean
): Promise<void> {
  if (!isStaff) {
    await interaction.reply({
      content:
        "❌ This command is only available to the MysticServers Support Team.",
      flags: 64,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "dashboard") {
    await interaction.deferReply({ flags: 64 });

    try {
      await refreshVpsManagementDashboard(interaction.client);
      await interaction.editReply({
        content: "✅ VPS management dashboard refreshed.",
      });
    } catch (error) {
      console.error("❌ Failed to refresh VPS dashboard:", error);
      await interaction.editReply({
        content: "❌ Failed to refresh the VPS management dashboard. Check the bot console for details.",
      });
    }
    return;
  }

  if (subcommand === "renew") {
    const vpsNumber = interaction.options.getInteger("number", true);
    const months = interaction.options.getInteger("months", true);

    await interaction.deferReply({ flags: 64 });

    try {
      const vps = await getVpsByNumber(vpsNumber);

      if (!vps) {
        await interaction.editReply({
          content: `❌ VPS #${String(vpsNumber).padStart(6, "0")} was not found.`,
        });
        return;
      }

      const renewed = await renewVps(
        vps.id,
        months,
        interaction.user.id
      );

      await refreshVpsManagementDashboard(interaction.client);

      const expiry = new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeZone: "Asia/Kolkata",
      }).format(new Date(renewed.expiresAt));

      await interaction.editReply({
        content:
          `✅ **VPS #${String(renewed.vpsNumber).padStart(6, "0")} renewed successfully.**\n\n` +
          `🖥️ **Plan:** ${renewed.planName}\n` +
          `📅 **Renewal:** ${months} month${months === 1 ? "" : "s"}\n` +
          `📆 **New expiry:** ${expiry}`,
      });
    } catch (error) {
      console.error("❌ Failed to renew VPS:", error);
      await interaction.editReply({
        content: "❌ Failed to renew the VPS. Check the bot console for details.",
      });
    }
    return;
  }
}

// ============================================================
// Pricing Plan Selection
// ============================================================

async function handlePricingPlan(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const parts =
    interaction.customId.split(":");

  const location =
    parts[2] as PricingLocation;

  if (
    location !== "India" &&
    location !== "Singapore" &&
    location !== "Japan"
  ) {
    await interaction.reply({
      content:
        "❌ Invalid pricing location.",
      flags: 64,
    });

    return;
  }

  const selectedValue =
    interaction.values[0];

  if (!selectedValue) {
    await interaction.reply({
      content:
        "❌ Please select a VPS plan.",
      flags: 64,
    });

    return;
  }

  const valueParts =
    selectedValue.split(":");

  const planId =
    valueParts[3];

  if (!planId) {
    await interaction.reply({
      content:
        "❌ Invalid VPS plan.",
      flags: 64,
    });

    return;
  }

  const result =
    await createPlanDetails(
      planId,
      location
    );

  /*
   * The public pricing message must
   * never be modified.
   */

  await interaction.reply({
    embeds: [
      result.embed,
    ],

    components:
      result.components,

    flags: 64,
  });
}

// ============================================================
// Pricing Buttons
// ============================================================

async function handlePricingButton(
  interaction: ButtonInteraction
): Promise<void> {
  const customId =
    interaction.customId;

  // ==========================================================
  // OPEN PRICING FROM WELCOME
  // ==========================================================

  if (
    customId ===
    "pricing:open"
  ) {
    await interaction.reply({
      ...await createPricingPanel(
        "India"
      ),
      flags: 64,
    });

    return;
  }

  // ==========================================================
  // LOCATION
  // ==========================================================

  if (
    customId.startsWith(
      "pricing:location:"
    )
  ) {
    const location =
      customId.replace(
        "pricing:location:",
        ""
      ) as PricingLocation;

    if (
      location !== "India" &&
      location !== "Singapore" &&
      location !== "Japan"
    ) {
      await interaction.reply({
        content:
          "❌ Invalid pricing location.",
        flags: 64,
      });

      return;
    }

    /*
     * This may come from the PUBLIC
     * pricing message.
     *
     * Therefore create a PRIVATE
     * pricing panel.
     */

    await interaction.reply({
      ...await createPricingPanel(
        location
      ),
      flags: 64,
    });

    return;
  }

  // ==========================================================
  // BACK TO PLANS
  // ==========================================================

  if (
    customId.startsWith(
      "pricing:back:"
    )
  ) {
    const location =
      customId.replace(
        "pricing:back:",
        ""
      ) as PricingLocation;

    if (
      location !== "India" &&
      location !== "Singapore" &&
      location !== "Japan"
    ) {
      return;
    }

    /*
     * This is already inside the
     * customer's private interaction.
     */

    await interaction.update(
      await createPricingPanel(
        location
      )
    );

    return;
  }

  // ==========================================================
  // CREATE VPS TICKET
  // ==========================================================

  if (
    customId.startsWith(
      "pricing:create:"
    )
  ) {
    await createPricingTicket(
      interaction
    );

    return;
  }
}

// ============================================================
// Create VPS Sales Ticket
// ============================================================

async function createPricingTicket(
  interaction: ButtonInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content:
        "❌ Tickets can only be created inside the server.",
      flags: 64,
    });

    return;
  }

  const parts =
    interaction.customId.split(":");

  const location =
    parts[2] as PricingLocation;

  const planId =
    parts[3];

  if (
    !location ||
    !planId
  ) {
    await interaction.reply({
      content:
        "❌ Invalid VPS selection.",
      flags: 64,
    });

    return;
  }

  if (
    location !== "India" &&
    location !== "Singapore" &&
    location !== "Japan"
  ) {
    await interaction.reply({
      content:
        "❌ Invalid VPS location.",
      flags: 64,
    });

    return;
  }

  await interaction.deferUpdate();

  try {
    const plan =
      await getPricingPlanById(
        planId
      );

    if (!plan) {
      await interaction.editReply({
        content:
          "❌ This VPS plan is no longer available.",
        embeds: [],
        components: [],
      });

      return;
    }

    const member =
      await interaction.guild.members.fetch(
        interaction.user.id
      );

    const ticketChannel =
      await createTicket(
        interaction.guild,
        member,
        "Sales",
        {
          location,

          planId:
            plan.id,

          planName:
            plan.name,

          priceInr:
            plan.priceInr,

          priceUsd:
            plan.priceUsd,

          ramGb:
            plan.ramGb,

          storageGb:
            plan.storageGb,

          vcpu:
            plan.vcpu,

          fullRootAccess:
            true,

          instantDeployment:
            true,

          discordSupport:
            true,

          networkAllocation:
            "IPv4/IPv6 availability depends on provider and location",

          cpuModels:
            CPU_MODELS,
        }
      );

    await interaction.editReply({
      content:
        `🎫 **Sales ticket created!**\n\n` +
        `Your VPS selection has been attached to the ticket.\n\n` +
        `${ticketChannel}`,

      embeds: [],

      components: [],
    });

  } catch (error) {
    console.error(
      "❌ Failed to create VPS Sales ticket:",
      error
    );

    await interaction.editReply({
      content:
        "❌ We couldn't create your Sales ticket. You may already have an open ticket.",

      embeds: [],

      components: [],
    });
  }
}

// ============================================================
// Ticket Buttons
// ============================================================

async function handleTicketButton(
  interaction: ButtonInteraction
): Promise<void> {
  const customId =
    interaction.customId;

  // ==========================================================
  // CREATE TICKET FROM WELCOME
  // ==========================================================

  if (
    customId ===
    "ticket:create"
  ) {
    await interaction.reply({
      ...createTicketPanel(),
      flags: 64,
    });

    return;
  }

  // ==========================================================
  // DEPARTMENT
  // ==========================================================

  if (
    customId.startsWith(
      "ticket:"
    ) &&
    ![
      "ticket:create",
      "ticket:claim",
      "ticket:close",
      "ticket:close:confirm",
      "ticket:close:cancel",
    ].includes(
      customId
    )
  ) {
    const departmentKey =
      customId.replace(
        "ticket:",
        ""
      );

    const department =
      departmentNames[
        departmentKey
      ];

    if (!department) {
      await interaction.reply({
        content:
          "❌ Invalid ticket department.",
        flags: 64,
      });

      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content:
          "❌ Tickets can only be created inside a server.",
        flags: 64,
      });

      return;
    }

    await interaction.deferReply({
      flags: 64,
    });

    const member =
      await interaction.guild.members.fetch(
        interaction.user.id
      );

    const ticketChannel =
      await createTicket(
        interaction.guild,
        member,
        department
      );

    await interaction.editReply({
      content:
        `✅ Your **${department}** ticket has been created: ${ticketChannel}`,
    });

    return;
  }

  // ==========================================================
  // PROVISION VPS
  // ==========================================================

  if (customId === "vps:provision") {
    await openVpsProvisionModal(interaction);
    return;
  }

  // ==========================================================
  // CLAIM
  // ==========================================================

  if (
    customId ===
    "ticket:claim"
  ) {
    await claimTicket(
      interaction
    );

    return;
  }

  // ==========================================================
  // CLOSE
  // ==========================================================

  if (customId === "ticket:close") {
    await confirmCloseTicket(interaction);
    return;
  }

  if (customId === "ticket:close:confirm") {
    await closeTicket(interaction);
    return;
  }

  if (customId === "ticket:close:cancel") {
    await interaction.update({
      content: "✅ Ticket closure cancelled. The ticket remains open.",
      components: [],
    });
    return;
  }
}


// ============================================================
// VPS Provisioning
// ============================================================

type VpsProvisionDraft = {
  ticketId: string;
  providerInstanceId: string;
  hostname: string;
  publicIpv4?: string;
  privateIpv4?: string;
  ipv6?: string;
  billingCycleMonths: number;
};

const vpsProvisionDrafts = new Map<string, VpsProvisionDraft>();

function isStaffMember(interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction): boolean {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const supportRoleId = process.env.SUPPORT_ROLE_ID;

  return Boolean(
    member &&
      (member.permissions.has(PermissionFlagsBits.Administrator) ||
        (supportRoleId && member.roles.cache.has(supportRoleId)))
  );
}

async function handleVpsButton(
  interaction: ButtonInteraction
): Promise<void> {
  if (interaction.customId.startsWith("vps:provision:access:")) {
    const ticketId = interaction.customId.replace(
      "vps:provision:access:",
      ""
    );

    const draft = vpsProvisionDrafts.get(ticketId);

    if (!draft) {
      await interaction.reply({
        content: "❌ The provisioning session expired. Please click **Provision VPS** again.",
        flags: 64,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`vps:provision:access:${ticketId}`)
      .setTitle("VPS Access Details");

    const username = new TextInputBuilder()
      .setCustomId("ssh_username")
      .setLabel("SSH Username")
      .setPlaceholder("root")
      .setValue("root")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(64);

    const port = new TextInputBuilder()
      .setCustomId("ssh_port")
      .setLabel("SSH Port")
      .setPlaceholder("22")
      .setValue("22")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(5);

    const password = new TextInputBuilder()
      .setCustomId("root_password")
      .setLabel("Root / SSH Password")
      .setPlaceholder("Enter the password generated by the provider")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(200);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(username),
      new ActionRowBuilder<TextInputBuilder>().addComponents(port),
      new ActionRowBuilder<TextInputBuilder>().addComponents(password)
    );

    await interaction.showModal(modal);
    return;
  }

  await interaction.reply({
    content: "❌ Unknown VPS action.",
    flags: 64,
  });
}

async function openVpsProvisionModal(
  interaction: ButtonInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "❌ This can only be used inside the server.",
      flags: 64,
    });
    return;
  }

  if (!isStaffMember(interaction)) {
    await interaction.reply({
      content: "❌ Only Support Team members can provision VPS servers.",
      flags: 64,
    });
    return;
  }

  if (
    !interaction.channel ||
    interaction.channel.type !== ChannelType.GuildText
  ) {
    await interaction.reply({
      content: "❌ This button can only be used inside a ticket channel.",
      flags: 64,
    });
    return;
  }

  const ticketId = getTicketIdFromChannel(interaction.channel);

  if (!ticketId) {
    await interaction.reply({
      content: "❌ This ticket is not linked to the database.",
      flags: 64,
    });
    return;
  }

  const ticket = await getTicketById(ticketId);

  if (!ticket) {
    await interaction.reply({
      content: "❌ Ticket not found.",
      flags: 64,
    });
    return;
  }

  if (ticket.status === "closed") {
    await interaction.reply({
      content: "❌ This ticket is already closed.",
      flags: 64,
    });
    return;
  }

  if (ticket.department !== "sales") {
    await interaction.reply({
      content: "❌ VPS provisioning is only available for Sales tickets.",
      flags: 64,
    });
    return;
  }

  const existingVps = await getVpsByTicketId(ticketId);

  if (existingVps) {
    await interaction.reply({
      content: `⚠️ This ticket already has VPS **#${String(existingVps.vpsNumber).padStart(6, "0")}** provisioned.`,
      flags: 64,
    });
    return;
  }

  const metadata = await getTicketCreatedMetadata(ticketId);

  if (!metadata?.planName || !metadata.location) {
    await interaction.reply({
      content: "❌ The selected VPS plan could not be found in this ticket.",
      flags: 64,
    });
    return;
  }

  const billingSelect = new StringSelectMenuBuilder()
    .setCustomId(`vps:billing:${ticketId}`)
    .setPlaceholder("Select billing cycle")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("1 Month")
        .setDescription("Monthly VPS billing")
        .setValue("1")
        .setEmoji("📅"),
      new StringSelectMenuOptionBuilder()
        .setLabel("3 Months")
        .setDescription("Three-month billing")
        .setValue("3")
        .setEmoji("📅"),
      new StringSelectMenuOptionBuilder()
        .setLabel("6 Months")
        .setDescription("Six-month billing")
        .setValue("6")
        .setEmoji("📅"),
      new StringSelectMenuOptionBuilder()
        .setLabel("12 Months")
        .setDescription("Annual billing")
        .setValue("12")
        .setEmoji("📅")
    );

  await interaction.reply({
    content: "🧾 **Select the customer's billing cycle before provisioning.**\n\nThe VPS plan, resources, location and monthly price are already attached to this ticket.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(billingSelect)],
    flags: 64,
  });
}

async function handleVpsBillingSelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ This can only be used inside the server.", flags: 64 });
    return;
  }

  if (!isStaffMember(interaction)) {
    await interaction.reply({ content: "❌ Only Support Team members can provision VPS servers.", flags: 64 });
    return;
  }

  const ticketId = interaction.customId.replace("vps:billing:", "");
  const billingCycleMonths = Number(interaction.values[0]);

  if (![1, 3, 6, 12].includes(billingCycleMonths)) {
    await interaction.reply({ content: "❌ Invalid billing cycle.", flags: 64 });
    return;
  }

  const ticket = await getTicketById(ticketId);
  if (!ticket || ticket.status === "closed") {
    await interaction.reply({ content: "❌ This ticket is no longer available for provisioning.", flags: 64 });
    return;
  }

  const existingVps = await getVpsByTicketId(ticketId);
  if (existingVps) {
    await interaction.reply({ content: `⚠️ This ticket already has VPS **#${String(existingVps.vpsNumber).padStart(6, "0")}** provisioned.`, flags: 64 });
    return;
  }

  const metadata = await getTicketCreatedMetadata(ticketId);
  if (!metadata?.planName || !metadata.location) {
    await interaction.reply({ content: "❌ The selected VPS plan could not be found in this ticket.", flags: 64 });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`vps:provision:network:${ticketId}:${billingCycleMonths}`)
    .setTitle("Provision MysticServers VPS");

  const providerId = new TextInputBuilder()
    .setCustomId("provider_instance_id")
    .setLabel("Provider / VPS ID")
    .setPlaceholder("Example: 1042")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const hostname = new TextInputBuilder()
    .setCustomId("hostname")
    .setLabel("Hostname")
    .setPlaceholder("Example: mystic-vps-000001")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const publicIpv4 = new TextInputBuilder()
    .setCustomId("public_ipv4")
    .setLabel("Public IPv4 (optional)")
    .setPlaceholder("Leave blank if not assigned")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(45);

  const privateIpv4 = new TextInputBuilder()
    .setCustomId("private_ipv4")
    .setLabel("Private IPv4 (optional)")
    .setPlaceholder("Leave blank if not assigned")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(45);

  const ipv6 = new TextInputBuilder()
    .setCustomId("ipv6")
    .setLabel("IPv6 (optional)")
    .setPlaceholder("Leave blank if not assigned")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(80);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(providerId),
    new ActionRowBuilder<TextInputBuilder>().addComponents(hostname),
    new ActionRowBuilder<TextInputBuilder>().addComponents(publicIpv4),
    new ActionRowBuilder<TextInputBuilder>().addComponents(privateIpv4),
    new ActionRowBuilder<TextInputBuilder>().addComponents(ipv6)
  );

  await interaction.showModal(modal);
}

async function handleVpsNetworkModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "❌ This can only be used inside the server.",
      flags: 64,
    });
    return;
  }

  if (!isStaffMember(interaction)) {
    await interaction.reply({
      content: "❌ Only Support Team members can provision VPS servers.",
      flags: 64,
    });
    return;
  }

  const networkValue = interaction.customId.replace("vps:provision:network:", "");
  const [ticketId, billingCycleText] = networkValue.split(":");
  const billingCycleMonths = Number(billingCycleText);

  if (![1, 3, 6, 12].includes(billingCycleMonths)) {
    await interaction.reply({ content: "❌ Invalid billing cycle.", flags: 64 });
    return;
  }

  const ticket = await getTicketById(ticketId);

  if (!ticket || ticket.status === "closed") {
    await interaction.reply({
      content: "❌ This ticket is no longer available for provisioning.",
      flags: 64,
    });
    return;
  }

  const existingVps = await getVpsByTicketId(ticketId);

  if (existingVps) {
    await interaction.reply({
      content: "⚠️ A VPS has already been provisioned for this ticket.",
      flags: 64,
    });
    return;
  }

  vpsProvisionDrafts.set(ticketId, {
    ticketId,
    providerInstanceId: interaction.fields.getTextInputValue("provider_instance_id").trim(),
    hostname: interaction.fields.getTextInputValue("hostname").trim(),
    publicIpv4: optionalField(interaction, "public_ipv4"),
    privateIpv4: optionalField(interaction, "private_ipv4"),
    ipv6: optionalField(interaction, "ipv6"),
    billingCycleMonths,
  });

  const accessButton = new ButtonBuilder()
    .setCustomId(`vps:provision:access:${ticketId}`)
    .setLabel("Enter Access Details")
    .setEmoji("🔐")
    .setStyle(ButtonStyle.Primary);

  await interaction.reply({
    content:
      "✅ Network details saved for this provisioning session. Click **Enter Access Details** to enter the SSH username, port, and password.",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(accessButton),
    ],
    flags: 64,
  });
}

async function handleVpsAccessModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "❌ This can only be used inside the server.",
      flags: 64,
    });
    return;
  }

  if (!isStaffMember(interaction)) {
    await interaction.reply({
      content: "❌ Only Support Team members can provision VPS servers.",
      flags: 64,
    });
    return;
  }

  const ticketId = interaction.customId.replace(
    "vps:provision:access:",
    ""
  );

  const draft = vpsProvisionDrafts.get(ticketId);

  if (!draft) {
    await interaction.reply({
      content: "❌ The provisioning session expired. Please click **Provision VPS** again.",
      flags: 64,
    });
    return;
  }

  const ticket = await getTicketById(ticketId);

  if (!ticket || ticket.status === "closed") {
    vpsProvisionDrafts.delete(ticketId);
    await interaction.reply({
      content: "❌ This ticket is no longer available for provisioning.",
      flags: 64,
    });
    return;
  }

  const existingVps = await getVpsByTicketId(ticketId);

  if (existingVps) {
    vpsProvisionDrafts.delete(ticketId);
    await interaction.reply({
      content: "⚠️ A VPS has already been provisioned for this ticket.",
      flags: 64,
    });
    return;
  }

  const metadata = await getTicketCreatedMetadata(ticketId);

  if (!metadata?.planName || !metadata.location) {
    vpsProvisionDrafts.delete(ticketId);
    await interaction.reply({
      content: "❌ The selected VPS plan could not be recovered from this ticket.",
      flags: 64,
    });
    return;
  }

  const sshUsername = interaction.fields
    .getTextInputValue("ssh_username")
    .trim();

  const sshPortText = interaction.fields
    .getTextInputValue("ssh_port")
    .trim();

  const sshPort = Number(sshPortText);

  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
    await interaction.reply({
      content: "❌ SSH port must be a valid number between 1 and 65535.",
      flags: 64,
    });
    return;
  }

  const rootPassword = interaction.fields
    .getTextInputValue("root_password")
    .trim();

  if (!rootPassword) {
    await interaction.reply({
      content: "❌ Root / SSH password cannot be empty.",
      flags: 64,
    });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  try {
    const customer = await getCustomerById(ticket.customerId);

    if (!customer) {
      throw new Error("Customer record not found.");
    }

    const planId = typeof metadata.planId === "string" ? metadata.planId : undefined;

    const vps = await createVpsInstance({
      customerId: ticket.customerId,
      ticketId,
      planId,
      planName: String(metadata.planName),
      location: String(metadata.location),
      priceInr: Number(metadata.priceInr ?? 0),
      priceUsd: Number(metadata.priceUsd ?? 0),
      ramGb: Number(metadata.ramGb ?? 0),
      storageGb: Number(metadata.storageGb ?? 0),
      vcpu: Number(metadata.vcpu ?? 0),
      providerInstanceId: draft.providerInstanceId,
      hostname: draft.hostname,
      publicIpv4: draft.publicIpv4,
      privateIpv4: draft.privateIpv4,
      ipv6: draft.ipv6,
      sshUsername,
      sshPort,
      provisionedByDiscordId: interaction.user.id,
      billingCycleMonths: draft.billingCycleMonths,
    });

    const vpsNumber = String(vps.vpsNumber).padStart(6, "0");

    let dmSent = false;

    try {
      const user = await interaction.client.users.fetch(customer.discordUserId);

      const locationEmoji =
        metadata.location === "India"
          ? "🇮🇳"
          : metadata.location === "Singapore"
            ? "🇸🇬"
            : "🇯🇵";

      const networkLines = [
        draft.publicIpv4 ? `🌐 **Public IPv4:** ${draft.publicIpv4}` : "🌐 **Public IPv4:** Not assigned",
        draft.privateIpv4 ? `🔒 **Private IPv4:** ${draft.privateIpv4}` : "🔒 **Private IPv4:** Not assigned",
        draft.ipv6 ? `🌍 **IPv6:** ${draft.ipv6}` : "🌍 **IPv6:** Not assigned",
      ].join("\n");

      const sshHost = draft.publicIpv4 ?? draft.privateIpv4;
      const sshCommand = sshHost
        ? `ssh ${sshUsername}@${sshHost}${sshPort !== 22 ? ` -p ${sshPort}` : ""}`
        : "Public SSH address was not assigned. Contact MysticServers Support.";

      const dmEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🖥️ Your MysticServers VPS is Ready")
        .setDescription(
          `Hello <@${customer.discordUserId}>! 👋\n\n` +
            "Your MysticServers VPS has been successfully provisioned."
        )
        .addFields(
          {
            name: "🖥️ VPS",
            value: `#${vpsNumber}`,
            inline: true,
          },
          {
            name: "📦 Plan",
            value: String(metadata.planName),
            inline: true,
          },
          {
            name: "📍 Location",
            value: `${locationEmoji} ${metadata.location}`,
            inline: true,
          },
          {
            name: "🧠 RAM",
            value: `${metadata.ramGb} GB`,
            inline: true,
          },
          {
            name: "⚡ vCore",
            value: `${metadata.vcpu}`,
            inline: true,
          },
          {
            name: "💾 Disk",
            value: `${metadata.storageGb} GB`,
            inline: true,
          },
          {
            name: "🧾 Billing",
            value: `${draft.billingCycleMonths} month${draft.billingCycleMonths === 1 ? "" : "s"}`,
            inline: true,
          },
          {
            name: "📅 Expires",
            value: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(vps.expiresAt),
            inline: true,
          },
          {
            name: "🌐 Network",
            value: networkLines,
            inline: false,
          },
          {
            name: "🔐 SSH Access",
            value:
              `👤 **Username:** \`${sshUsername}\`\n` +
              `🔌 **Port:** \`${sshPort}\`\n` +
              `🔑 **Password:** ||${rootPassword}||\n` +
              `🔗 **SSH:** \`${sshCommand}\``,
            inline: false,
          }
        )
        .setFooter({
          text: "MysticServers • Reliable infrastructure. Simple management.",
        })
        .setTimestamp();

      await user.send({
        embeds: [dmEmbed],
      });

      dmSent = true;
    } catch (dmError) {
      console.error("❌ Failed to DM VPS credentials:", dmError);
    }

    await recordTicketEvent(
      ticketId,
      "vps_provisioned",
      interaction.user.id,
      {
        vpsId: vps.id,
        vpsNumber: vps.vpsNumber,
        providerInstanceId: draft.providerInstanceId,
        hostname: draft.hostname,
        publicIpv4: draft.publicIpv4 ?? null,
        privateIpv4: draft.privateIpv4 ?? null,
        ipv6: draft.ipv6 ?? null,
        sshPort,
        sshUsername,
        dmSent,
      }
    );

    const channel =
      interaction.channel?.type === ChannelType.GuildText
        ? interaction.channel
        : null;

    if (channel) {
      const locationEmoji =
        metadata.location === "India"
          ? "🇮🇳"
          : metadata.location === "Singapore"
            ? "🇸🇬"
            : "🇯🇵";

      const provisionEmbed = new EmbedBuilder()
        .setColor(dmSent ? 0x57f287 : 0xfee75c)
        .setTitle(`🖥️ VPS #${vpsNumber} Provisioned`)
        .setDescription(
          `${locationEmoji} **${metadata.location}** • **${metadata.planName}**\n\n` +
            `🧠 **${metadata.ramGb} GB RAM**  •  ⚡ **${metadata.vcpu} vCore**  •  💾 **${metadata.storageGb} GB Disk**\n\n` +
            `🌐 **Public IPv4:** ${draft.publicIpv4 ?? "Not assigned"}\n` +
            `🔒 **Private IPv4:** ${draft.privateIpv4 ?? "Not assigned"}\n` +
            `🌍 **IPv6:** ${draft.ipv6 ?? "Not assigned"}\n` +
            `🖥️ **Hostname:** \`${draft.hostname}\`\n` +
            `🔌 **SSH Port:** \`${sshPort}\`\n\n` +
            (dmSent
              ? "📨 **Customer:** VPS details sent by Direct Message."
              : "⚠️ **Customer:** Direct Message failed. Please deliver the credentials securely to the customer manually.")
        )
        .setFooter({
          text: "MysticServers • VPS Provisioning",
        })
        .setTimestamp();

      await channel.send({
        embeds: [provisionEmbed],
      });
    }

    vpsProvisionDrafts.delete(ticketId);

    await refreshVpsManagementDashboard(interaction.client);

    await interaction.editReply({
      content:
        dmSent
          ? `✅ **VPS #${vpsNumber} provisioned successfully.**\n\n📨 The customer's VPS details were sent by Direct Message.`
          : `⚠️ **VPS #${vpsNumber} was provisioned, but the customer's Direct Message failed.**\n\nPlease deliver the credentials securely to the customer manually.`,
    });
  } catch (error) {
    console.error("❌ Failed to provision VPS:", error);

    vpsProvisionDrafts.delete(ticketId);

    await interaction.editReply({
      content:
        "❌ VPS provisioning failed. No customer credentials were stored by the bot. Please verify the information and try again.",
    });
  }
}

function optionalField(
  interaction: ModalSubmitInteraction,
  customId: string
): string | undefined {
  const value = interaction.fields.getTextInputValue(customId).trim();
  return value || undefined;
}

// ============================================================
// Get Ticket ID From Channel
// ============================================================

function getTicketIdFromChannel(
  channel: TextChannel
): string | null {
  const topic =
    channel.topic ?? "";

  const match =
    topic.match(
      /ticket-id:([^\s]+)/
    );

  return match?.[1] ?? null;
}

// ============================================================
// HTML Escape
// ============================================================

function escapeHtml(
  value: string
): string {
  return value
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

// ============================================================
// Fetch All Messages
// ============================================================

async function fetchAllMessages(
  channel: TextChannel
): Promise<Message[]> {
  const messages: Message[] = [];

  let before: string | undefined;

  while (true) {
    const batch =
      await channel.messages.fetch({
        limit: 100,

        ...(before
          ? { before }
          : {}),
      });

    if (
      batch.size === 0
    ) {
      break;
    }

    messages.push(
      ...batch.values()
    );

    const oldest =
      batch.last();

    if (!oldest) {
      break;
    }

    before =
      oldest.id;

    if (
      batch.size < 100
    ) {
      break;
    }
  }

  /*
   * Discord returns newest first.
   *
   * Transcript should display
   * oldest → newest.
   */

  messages.sort(
    (
      a,
      b
    ) =>
      a.createdTimestamp -
      b.createdTimestamp
  );

  return messages;
}

// ============================================================
// Generate Ticket Transcript
// ============================================================

async function generateTicketTranscript(
  channel: TextChannel,
  ticketNumber: number
): Promise<string> {
  const messages =
    await fetchAllMessages(
      channel
    );

  const transcriptDirectory =
    path.join(
      process.cwd(),
      "transcripts"
    );

  await fs.mkdir(
    transcriptDirectory,
    {
      recursive: true,
    }
  );

  const paddedNumber =
    String(
      ticketNumber
    ).padStart(
      6,
      "0"
    );

  const fileName =
    `ticket-${paddedNumber}.html`;

  const filePath =
    path.join(
      transcriptDirectory,
      fileName
    );

  const messageHtml =
    messages
      .map(
        (message) => {
          const username =
            escapeHtml(
              message.author.username
            );

          const displayName =
            escapeHtml(
              message.member?.displayName ??
              message.author.globalName ??
              message.author.username
            );

          const avatar =
            escapeHtml(
              message.author.displayAvatarURL({
                size: 64,
              })
            );

          const timestamp =
            escapeHtml(
              new Date(
                message.createdTimestamp
              ).toLocaleString()
            );

          let content =
            message.content
              ? escapeHtml(
                  message.content
                )
              : "";

          if (!content) {
            content =
              "<em>No text content</em>";
          }

          // ----------------------------------------------------
          // Attachments
          // ----------------------------------------------------

          if (
            message.attachments.size >
            0
          ) {
            const attachments =
              message.attachments
                .map(
                  (
                    attachment
                  ) => {
                    const url =
                      escapeHtml(
                        attachment.url
                      );

                    const name =
                      escapeHtml(
                        attachment.name ??
                        "Attachment"
                      );

                    return `
                      <div class="attachment">
                        📎
                        <a
                          href="${url}"
                          target="_blank"
                        >
                          ${name}
                        </a>
                      </div>
                    `;
                  }
                )
                .join("");

            content +=
              attachments;
          }

          // ----------------------------------------------------
          // Embeds
          // ----------------------------------------------------

          if (
            message.embeds.length >
            0
          ) {
            content +=
              `
              <div class="system-note">
                📦 Message contains ${message.embeds.length} embed(s)
              </div>
              `;
          }

          return `
            <div class="message">
              <img
                class="avatar"
                src="${avatar}"
                alt="Avatar"
              />

              <div class="message-body">
                <div class="message-header">
                  <span class="display-name">
                    ${displayName}
                  </span>

                  <span class="username">
                    @${username}
                  </span>

                  <span class="timestamp">
                    ${timestamp}
                  </span>
                </div>

                <div class="content">
                  ${content}
                </div>
              </div>
            </div>
          `;
        }
      )
      .join("");

  const html = `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>
    MysticServers Ticket #${paddedNumber}
  </title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      background: #111214;
      color: #dcddde;
      font-family:
        Arial,
        Helvetica,
        sans-serif;
    }

    .container {
      max-width: 1000px;
      margin: 40px auto;
      padding: 0 20px;
    }

    .header {
      background: #1e1f22;
      border-radius: 12px;
      padding: 28px;
      margin-bottom: 20px;
      border: 1px solid #2b2d31;
    }

    .brand {
      font-size: 24px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
    }

    .ticket-title {
      font-size: 20px;
      font-weight: 600;
      color: #5865f2;
      margin-bottom: 18px;
    }

    .info {
      display: grid;
      grid-template-columns:
        repeat(
          auto-fit,
          minmax(220px, 1fr)
        );
      gap: 12px;
    }

    .info-card {
      background: #2b2d31;
      border-radius: 8px;
      padding: 12px;
    }

    .info-label {
      font-size: 12px;
      color: #949ba4;
      margin-bottom: 4px;
      text-transform: uppercase;
    }

    .info-value {
      color: #ffffff;
      font-weight: 600;
    }

    .messages {
      background: #1e1f22;
      border-radius: 12px;
      padding: 20px;
      border: 1px solid #2b2d31;
    }

    .message {
      display: flex;
      gap: 14px;
      padding: 14px 8px;
      border-bottom: 1px solid #2b2d31;
    }

    .message:last-child {
      border-bottom: none;
    }

    .avatar {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .message-body {
      min-width: 0;
      flex: 1;
    }

    .message-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 5px;
    }

    .display-name {
      color: #ffffff;
      font-weight: 700;
    }

    .username {
      color: #949ba4;
      font-size: 12px;
    }

    .timestamp {
      color: #72767d;
      font-size: 11px;
    }

    .content {
      color: #dcddde;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }

    .attachment {
      margin-top: 8px;
      padding: 8px;
      background: #2b2d31;
      border-radius: 6px;
    }

    .attachment a {
      color: #00aff4;
      text-decoration: none;
    }

    .attachment a:hover {
      text-decoration: underline;
    }

    .system-note {
      margin-top: 8px;
      padding: 6px 8px;
      background: #2b2d31;
      color: #949ba4;
      border-radius: 6px;
      font-size: 12px;
    }

    .footer {
      text-align: center;
      color: #72767d;
      font-size: 12px;
      padding: 20px;
    }

    @media (
      max-width: 600px
    ) {
      .container {
        margin: 15px auto;
        padding: 0 10px;
      }

      .header,
      .messages {
        padding: 15px;
      }

      .message {
        gap: 10px;
      }

      .avatar {
        width: 36px;
        height: 36px;
      }
    }
  </style>
</head>

<body>

  <div class="container">

    <div class="header">

      <div class="brand">
        🌐 MysticServers
      </div>

      <div class="ticket-title">
        🎫 Ticket #${paddedNumber}
      </div>

      <div class="info">

        <div class="info-card">
          <div class="info-label">
            Channel
          </div>

          <div class="info-value">
            ${escapeHtml(
              channel.name
            )}
          </div>
        </div>

        <div class="info-card">
          <div class="info-label">
            Messages
          </div>

          <div class="info-value">
            ${messages.length}
          </div>
        </div>

        <div class="info-card">
          <div class="info-label">
            Generated
          </div>

          <div class="info-value">
            ${escapeHtml(
              new Date().toLocaleString()
            )}
          </div>
        </div>

      </div>

    </div>

    <div class="messages">

      ${messageHtml}

    </div>

    <div class="footer">
      MysticServers Support • Ticket Transcript
    </div>

  </div>

</body>

</html>
`;

  await fs.writeFile(
    filePath,
    html,
    "utf8"
  );

  return filePath;
}

// ============================================================
// Claim Ticket
// ============================================================

async function claimTicket(
  interaction: ButtonInteraction
): Promise<void> {
  if (
    !interaction.guild
  ) {
    return;
  }

  // ----------------------------------------------------------
  // Support member
  // ----------------------------------------------------------

  const member =
    await interaction.guild.members.fetch(
      interaction.user.id
    );

  const supportRoleId =
    process.env.SUPPORT_ROLE_ID;

  if (
    !supportRoleId ||
    !member.roles.cache.has(
      supportRoleId
    )
  ) {
    await interaction.reply({
      content:
        "❌ Only Support Team members can claim tickets.",
      flags: 64,
    });

    return;
  }

  // ----------------------------------------------------------
  // Ticket channel
  // ----------------------------------------------------------

  if (
    !interaction.channel ||
    interaction.channel.type !==
      ChannelType.GuildText
  ) {
    await interaction.reply({
      content:
        "❌ This button can only be used inside a ticket channel.",
      flags: 64,
    });

    return;
  }

  const channel =
    interaction.channel;

  // ----------------------------------------------------------
  // Database ticket ID
  // ----------------------------------------------------------

  const ticketId =
    getTicketIdFromChannel(
      channel
    );

  if (!ticketId) {
    await interaction.reply({
      content:
        "❌ This ticket is not linked to a database ticket.",
      flags: 64,
    });

    return;
  }

  await interaction.deferReply();

  try {
    // --------------------------------------------------------
    // Check current ticket
    // --------------------------------------------------------

    const existingTicket =
      await getTicketById(
        ticketId
      );

    if (!existingTicket) {
      await interaction.editReply({
        content:
          "❌ This ticket no longer exists in the database.",
      });

      return;
    }

    if (
      existingTicket.status ===
      "closed"
    ) {
      await interaction.editReply({
        content:
          "❌ This ticket is already closed.",
      });

      return;
    }

    if (
      existingTicket.status ===
      "claimed"
    ) {
      const claimedBy =
        existingTicket.claimedByDiscordId
          ? `<@${existingTicket.claimedByDiscordId}>`
          : "another staff member";

      await interaction.editReply({
        content:
          `⚠️ This ticket has already been claimed by ${claimedBy}.`,
      });

      return;
    }

    // --------------------------------------------------------
    // Claim in database
    // --------------------------------------------------------

    const ticket =
      await claimDatabaseTicket(
        ticketId,
        member.user.id
      );

    // --------------------------------------------------------
    // Staff response
    // --------------------------------------------------------

    await interaction.editReply({
      content:
        `👤 **Ticket claimed**\n\n` +
        `🟡 **Status:** Claimed\n` +
        `👤 **Assigned to:** ${member}`,
    });

    // --------------------------------------------------------
    // Ticket channel update
    // --------------------------------------------------------

    await channel.send({
      content:
        `📌 **Ticket claimed**\n\n` +
        `${member} is now handling this ticket.\n\n` +
        `🟡 **Status:** Claimed\n` +
        `👤 **Assigned to:** ${member}\n` +
        `🎫 **Ticket:** #${String(
          ticket.ticketNumber
        ).padStart(
          6,
          "0"
        )}`,
    });

    console.log(
      `👤 Ticket #${String(
        ticket.ticketNumber
      ).padStart(
        6,
        "0"
      )} claimed by ${member.user.tag}`
    );

  } catch (error) {
    console.error(
      "❌ Failed to claim ticket:",
      error
    );

    await interaction.editReply({
      content:
        "❌ This ticket could not be claimed. It may already be claimed or closed.",
    });
  }
}

// ============================================================
// Confirm Ticket Close
// ============================================================

async function confirmCloseTicket(
  interaction: ButtonInteraction
): Promise<void> {
  if (!interaction.guild) {
    return;
  }

  const member = await interaction.guild.members.fetch(
    interaction.user.id
  );

  const supportRoleId = process.env.SUPPORT_ROLE_ID;

  const isSupport = Boolean(
    supportRoleId && member.roles.cache.has(supportRoleId)
  );

  const isAdministrator = member.permissions.has(
    PermissionFlagsBits.Administrator
  );

  if (!isSupport && !isAdministrator) {
    await interaction.reply({
      content: "❌ Only Support Team members can close tickets.",
      flags: 64,
    });
    return;
  }

  await interaction.reply({
    content:
      "⚠️ **Close this ticket?**\n\n" +
      "Are you sure you want to close this ticket?\n" +
      "The transcript will be generated and the ticket channel will be deleted.",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket:close:confirm")
          .setLabel("Yes, Close")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ticket:close:cancel")
          .setLabel("Cancel")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
    flags: 64,
  });
}

// ============================================================
// Close Ticket
// ============================================================

async function closeTicket(
  interaction: ButtonInteraction
): Promise<void> {
  if (
    !interaction.guild
  ) {
    return;
  }

  // ----------------------------------------------------------
  // Staff member
  // ----------------------------------------------------------

  const member =
    await interaction.guild.members.fetch(
      interaction.user.id
    );

  const supportRoleId =
    process.env.SUPPORT_ROLE_ID;

  const isSupport =
    Boolean(
      supportRoleId &&
      member.roles.cache.has(
        supportRoleId
      )
    );

  const isAdministrator =
    member.permissions.has(
      PermissionFlagsBits.Administrator
    );

  if (
    !isSupport &&
    !isAdministrator
  ) {
    await interaction.reply({
      content:
        "❌ Only Support Team members can close tickets.",
      flags: 64,
    });

    return;
  }

  // ----------------------------------------------------------
  // Ticket channel
  // ----------------------------------------------------------

  if (
    !interaction.channel ||
    interaction.channel.type !==
      ChannelType.GuildText
  ) {
    await interaction.reply({
      content:
        "❌ This button can only be used inside a ticket channel.",
      flags: 64,
    });

    return;
  }

  const channel =
    interaction.channel;

  // ----------------------------------------------------------
  // Database ticket ID
  // ----------------------------------------------------------

  const ticketId =
    getTicketIdFromChannel(
      channel
    );

  if (!ticketId) {
    await interaction.reply({
      content:
        "❌ This ticket is not linked to a database ticket.",
      flags: 64,
    });

    return;
  }

  await interaction.deferReply();

  try {
    // --------------------------------------------------------
    // Get ticket
    // --------------------------------------------------------

    const existingTicket =
      await getTicketById(
        ticketId
      );

    if (!existingTicket) {
      await interaction.editReply({
        content:
          "❌ This ticket no longer exists in the database.",
      });

      return;
    }

    if (
      existingTicket.status ===
      "closed"
    ) {
      await interaction.editReply({
        content:
          "❌ This ticket is already closed.",
      });

      return;
    }

    // --------------------------------------------------------
    // Generate transcript BEFORE deleting channel
    // --------------------------------------------------------

    let transcriptPath:
      string | null = null;

    try {
      transcriptPath =
        await generateTicketTranscript(
          channel,
          existingTicket.ticketNumber
        );

      console.log(
        `📄 Transcript created: ${transcriptPath}`
      );

    } catch (transcriptError) {
      /*
       * Transcript failure should NOT prevent
       * the ticket from being closed.
       */

      console.error(
        "❌ Failed to generate ticket transcript:",
        transcriptError
      );
    }

    // --------------------------------------------------------
    // Close database ticket
    // --------------------------------------------------------

    const ticket =
      await closeDatabaseTicket(
        ticketId,
        member.user.id
      );

    // --------------------------------------------------------
    // Closing message
    // --------------------------------------------------------

    await interaction.editReply({
      content:
        `🔒 **Ticket closing...**\n\n` +
        `🔴 **Status:** Closed\n` +
        `👤 **Closed by:** ${member}\n\n` +
        (
          transcriptPath
            ? "📄 **Transcript:** Saved successfully.\n\n"
            : "⚠️ **Transcript:** Could not be generated.\n\n"
        ) +
        "This ticket will be deleted shortly.",
    });

    // --------------------------------------------------------
    // Public ticket update
    // --------------------------------------------------------

    await channel.send({
      content:
        `🔒 **Ticket closed**\n\n` +
        `🔴 **Status:** Closed\n` +
        `👤 **Closed by:** ${member}\n` +
        `🎫 **Ticket:** #${String(
          ticket.ticketNumber
        ).padStart(
          6,
          "0"
        )}\n\n` +
        (
          transcriptPath
            ? "📄 Transcript saved successfully.\n\n"
            : "⚠️ Transcript generation failed.\n\n"
        ) +
        "This channel will be removed shortly.",
    });

    console.log(
      `🔒 Ticket #${String(
        ticket.ticketNumber
      ).padStart(
        6,
        "0"
      )} closed by ${member.user.tag}`
    );

    // --------------------------------------------------------
    // Delete Discord channel
    // --------------------------------------------------------

    setTimeout(
      async () => {
        try {
          await channel.delete(
            "MysticServers ticket closed"
          );

          console.log(
            `🗑️ Ticket channel ${channel.id} deleted.`
          );

        } catch (error) {
          console.error(
            "❌ Failed to delete ticket channel:",
            error
          );
        }
      },
      3000
    );

  } catch (error) {
    console.error(
      "❌ Failed to close ticket:",
      error
    );

    await interaction.editReply({
      content:
        "❌ This ticket could not be closed. The database was not successfully updated, so the channel was not deleted.",
    });
  }
}