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
  AttachmentBuilder,
  Guild,
  ComponentType,
  ButtonComponent,
} from "discord.js";

import fs from "fs/promises";
import fsSync from "fs";
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
  createMinecraftPricingPanel,
  createMinecraftPlanDetails,
} from "../commands/minecraft";

import { getMinecraftPlanById } from "../config/minecraftPlans";

import {
  provisionMinecraftServer,
} from "../services/minecraftProvisioningService";

import {
  listMinecraftServersByDiscordUserId,
  getMinecraftServerByNumber,
  getMinecraftServerByTicketId,
} from "../services/minecraftDatabase";

import {
  getTicketById,
  getCustomerById,
  getOrCreateCustomer,
  getTicketCreatedMetadata,
  claimDatabaseTicket,
  closeDatabaseTicket,
  recordTicketEvent,
} from "../services/ticketDatabase";

import {
  createVpsInstance,
  updateVpsProvisioningDetails,
  deleteVpsInstanceForProvisionRollback,
  decommissionVpsInstance,
  getVpsByTicketId,
  getVpsByNumber,
  getVpsById,
  renewVps,
  listVpsByDiscordUserId,
  VpsInstanceRecord,
} from "../services/vpsDatabase";

import { provisionAutomaticVps, generateSecureInitialPassword, AutomaticVpsProvisionResult } from "../services/vpsProvisioningService";
import { allocateAndBuildCustomerInstanceName } from "../services/vpsNamingService";
import { getVpsNodeContainer, destroyVpsNodeContainer } from "../services/vpsNodeService";
import { diagnoseVpsTerminalSession, generateVpsTerminalSession, regenerateVpsTerminalSession, closeVpsTerminalSession } from "../services/vpsTerminalService";

import {
  refreshVpsManagementDashboard,
} from "../services/vpsLifecycle";

import { getGatewayDiagnostics } from "../services/publicSshGatewayReconciler";

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
    // Minecraft Select Menu
    // --------------------------------------------------------

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("minecraft:plan:")) {
      await handleMinecraftPlanSelect(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("minecraft:duration:")) {
      await handleMinecraftDurationSelect(interaction);
      return;
    }

    // --------------------------------------------------------
    // VPS Select Menus
    // --------------------------------------------------------

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("vps:billing:")) { await handleVpsBillingSelect(interaction); return; }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("vps:mode:")) { await handleVpsModeSelect(interaction); return; }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("vps:delete:select:")) { await handleVpsDeleteSelect(interaction); return; }

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
      if (interaction.customId.startsWith("vps:provision:auto:")) { await handleAutomaticVpsModal(interaction); return; }
      if (interaction.customId.startsWith("vps:provision:network:")) { await handleVpsNetworkModal(interaction); return; }

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
      if (interaction.customId.startsWith("minecraft:")) {
        await handleMinecraftButton(interaction);
        return;
      }

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

      if (interaction.customId.startsWith("vps:terminal:")) {
        await handleVpsTerminalButton(interaction);
        return;
      }

      if (interaction.customId.startsWith("vps:delete:")) {
        await handleVpsDeleteButton(interaction);
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

  if (interaction.commandName === "vps-create") {
    await handleVpsCreateCommand(interaction, isStaff);
    return;
  }

  if (interaction.commandName === "vps-delete") {
    await handleVpsDeleteCommand(interaction, isStaff);
    return;
  }

  if (interaction.commandName === "minecraft") {
    await handleCustomerMinecraftCommand(interaction, isStaff);
    return;
  }

  if (interaction.commandName === "minecraft-create") {
    await handleMinecraftCreateCommand(interaction, isStaff);
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
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "status" || subcommand === "info" || subcommand === "terminal") {
    await handleCustomerVpsCommand(interaction, subcommand);
    return;
  }

  if (!isStaff) {
    await interaction.reply({
      content:
        "❌ This command is only available to the MysticServers Support Team.",
      flags: 64,
    });
    return;
  }

  if (subcommand === "terminal-diagnose") {
    const vpsNumber = interaction.options.getInteger("number", true);
    await interaction.deferReply({ flags: 64 });
    try {
      const vps = await getVpsByNumber(vpsNumber);
      if (!vps) { await interaction.editReply({ content: "❌ VPS not found." }); return; }
      const container = await getVpsNodeContainer(vps.providerInstanceId);
      const diagnostics = await diagnoseVpsTerminalSession(vps.providerInstanceId);
      const gwDiag = await getGatewayDiagnostics(vpsNumber);

      const pubHost = vps.publicSshHost || "ssh.mysticservers.com";
      const pubPort = vps.publicSshPort ?? "N/A";
      const targetHost = vps.publicSshTargetHost || vps.privateIpv4 || "10.0.3.x";
      const natStateStr = gwDiag.vpsDiagnostic?.natRulePresent ? "Present (DNAT)" : "Missing / Stale";
      const targetTcpStr = gwDiag.vpsDiagnostic?.tcpReachable ? "Reachable" : "Unreachable";

      const staffDiagText =
        `🩺 **VPS #${String(vpsNumber).padStart(6, "0")} Staff Diagnostics**\n\n` +
        `📊 **Database State:** \`${vps.status}\`\n` +
        `📦 **LXC Container:** \`${vps.providerInstanceId}\` (${container.state})\n` +
        `🔒 **Persistent Private IP:** \`${vps.privateIpv4 ?? "Not assigned"}\`\n` +
        `🌐 **Public SSH Gateway:** \`${pubHost}:${pubPort}\` → \`${targetHost}:22\`\n` +
        `🔌 **Gateway NAT Rule:** ${natStateStr}\n` +
        `📡 **Target TCP Status:** ${targetTcpStr} (${gwDiag.vpsDiagnostic?.tcpMessage || "N/A"})\n` +
        `💾 **Storage Backend:** \`${vps.storageBackend || "directory"}\` (Enforced: ${vps.storageLimitEnforced ? "Yes" : "No"})\n` +
        `⚡ **CPU Allocation:** ${vps.vcpu} vCPU (Overcommit Ratio: ${process.env.VPS_CPU_OVERCOMMIT_RATIO || "2.0"})\n\n` +
        `**Terminal Session Diagnostics:**\n\`\`\`\n${diagnostics.trim().slice(0, 800)}\n\`\`\``;

      await interaction.editReply({ content: staffDiagText });
    } catch (error) {
      await interaction.editReply({ content: `❌ Terminal diagnostics failed: ${error instanceof Error ? error.message : "Unknown error"}` });
    }
    return;
  }

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

async function handleCustomerVpsCommand(
  interaction: ChatInputCommandInteraction,
  subcommand: "status" | "info" | "terminal"
): Promise<void> {
  await interaction.deferReply({ flags: 64 });

  try {
    const vpsInstances = await listVpsByDiscordUserId(interaction.user.id);

    if (vpsInstances.length === 0) {
      await interaction.editReply({ content: "ℹ️ You do not have any VPS instances." });
      return;
    }

    if (subcommand === "terminal") {
      const active = vpsInstances.filter((vps) => vps.status === "active");
      const requestedNumber = interaction.options.getInteger("number");
      const selected = requestedNumber === null ? active[0] : active.find((vps) => vps.vpsNumber === requestedNumber);
      if (!selected || (active.length !== 1 && requestedNumber === null)) {
        await interaction.editReply({ content: active.length === 0 ? "❌ You do not have an active VPS terminal to open." : "ℹ️ You have multiple active VPS instances. Run `/vps terminal number:<your VPS number>` to choose one." });
        return;
      }

      const vps = selected;
      const session = await generateVpsTerminalSession(vps.providerInstanceId);
      await interaction.editReply({ content: `🖥️ **VPS #${String(vps.vpsNumber).padStart(6, "0")} Terminal**\n\n${session.sshCommand ? `🔐 SSH\n\`${session.sshCommand}\`\n\n` : ""}${session.webUrl ? `🌐 Web Terminal\n${session.webUrl}\n\n` : ""}Keep these details private.` });
      return;
    }

    const requestedNumber = interaction.options.getInteger("number");
    const visibleInstances = requestedNumber === null ? vpsInstances : vpsInstances.filter((vps) => vps.vpsNumber === requestedNumber);
    if (visibleInstances.length === 0) { await interaction.editReply({ content: "❌ That VPS does not belong to you." }); return; }
    const embeds = await Promise.all(visibleInstances.map(async (vps) => {
      let providerState = "Unavailable";
      try { providerState = (await getVpsNodeContainer(vps.providerInstanceId)).state; } catch { providerState = "Error checking provider"; }
      const remainingMs = new Date(vps.expiresAt).getTime() - Date.now();
      const remaining = remainingMs > 0 ? `${Math.ceil(remainingMs / 86_400_000)} day(s)` : "Expired";
      const instanceDisplayName = vps.instanceName || vps.providerInstanceId;
      const storageEnforcedStr = vps.storageLimitEnforced ? "Enforced" : "Quota: Not enforced by directory backend";
      const gatewayStatusStr = vps.publicSshStatus === "verified" ? "🟢 Verified" : vps.publicSshStatus === "configured" ? "🟡 Configured (Unverified)" : "⚪ Unverified";

      return new EmbedBuilder()
        .setTitle(`🖥️ VPS #${String(vps.vpsNumber).padStart(6, "0")} — ${instanceDisplayName}`)
        .addFields(
          { name: "Instance Name", value: instanceDisplayName, inline: true },
          { name: "Hostname", value: vps.hostname, inline: true },
          { name: "Plan", value: vps.planName, inline: true },
          { name: "Location", value: vps.location, inline: true },
          { name: "Billing status", value: vps.status, inline: true },
          { name: "Provider state", value: providerState, inline: true },
          { name: "Resources", value: `${vps.vcpu} vCPU • ${vps.ramGb} GB RAM • ${vps.storageGb} GB Disk (${storageEnforcedStr})`, inline: false },
          {
            name: "🌐 Public SSH Access",
            value:
              `🌐 **Host:** \`${vps.publicSshHost || "ssh.mysticservers.com"}\`\n` +
              `🔌 **Port:** \`${vps.publicSshPort ?? "N/A"}\`\n` +
              `📊 **Gateway Status:** ${gatewayStatusStr}\n` +
              `🔐 **SSH Command:** \`${vps.publicSshPort ? `ssh -p ${vps.publicSshPort} root@${vps.publicSshHost || "ssh.mysticservers.com"}` : "N/A"}\``,
            inline: false,
          },
          {
            name: "🔒 Private Network",
            value:
              `🔒 **Persistent Private IPv4:** \`${vps.privateIpv4 ?? "Not assigned"}\`\n` +
              `📡 **Subnet:** 10.0.3.0/24 (Gateway: 10.0.3.1)`,
            inline: false,
          },
          {
            name: "Dates",
            value:
              `Provisioned: <t:${Math.floor(new Date(vps.provisionedAt ?? vps.createdAt ?? new Date()).getTime() / 1000)}:d>\n` +
              `Expires: <t:${Math.floor(new Date(vps.expiresAt).getTime() / 1000)}:d> (${remaining})` +
              (subcommand === "info" ? `\nRenewals: ${vps.renewalCount}` : ""),
            inline: false,
          }
        );
    }));
    await interaction.editReply({ embeds });
  } catch (error) {
    console.error("Failed to load customer VPS data", error);
    await interaction.editReply({ content: "❌ Unable to retrieve VPS information right now." });
  }
}

async function handleVpsCreateCommand(interaction: ChatInputCommandInteraction, isStaff: boolean): Promise<void> {
  if (!isStaff) { await interaction.reply({ content: "❌ This command is only available to the MysticServers Support Team.", flags: 64 }); return; }
  const user = interaction.options.getUser("user", true);
  const vcpu = interaction.options.getInteger("vcpu", true);
  const ramGb = interaction.options.getInteger("ram", true);
  const storageGb = interaction.options.getInteger("disk", true);
  const billingCycleMonths = interaction.options.getInteger("billing_months") ?? 1;
  const requestedHostname = interaction.options.getString("hostname")?.trim();
  if (requestedHostname && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(requestedHostname)) { await interaction.reply({ content: "❌ Hostname may only contain letters, numbers, and hyphens.", flags: 64 }); return; }
  await interaction.deferReply({ flags: 64 });

  let createdId: string | undefined;
  let provisioned: VpsInstanceRecord;
  let password = "";
  let result: AutomaticVpsProvisionResult;

  try {
    const customer = await getOrCreateCustomer(user.id, user.username, user.globalName ?? user.username);
    const { instanceName, sequence } = await allocateAndBuildCustomerInstanceName(customer.id, user.username, user.id);
    const planName = interaction.options.getString("plan_name")?.trim() || "Custom";
    const location = interaction.options.getString("location")?.trim() || "Unspecified";
    const hostname = requestedHostname || instanceName;

    const vps = await createVpsInstance({
      customerId: customer.id,
      instanceName,
      customerVpsSequence: sequence,
      planName,
      location,
      priceInr: 0,
      priceUsd: 0,
      ramGb,
      vcpu,
      storageGb,
      providerInstanceId: instanceName,
      hostname,
      sshUsername: "root",
      sshPort: 22,
      provisionedByDiscordId: interaction.user.id,
      billingCycleMonths,
    });

    createdId = vps.id;
    password = generateSecureInitialPassword();

    result = await provisionAutomaticVps({
      vpsNumber: vps.vpsNumber,
      containerName: instanceName,
      hostname,
      ramGb,
      vcpu,
      storageGb,
      initialPassword: password,
    });

    provisioned = await updateVpsProvisioningDetails({
      id: vps.id,
      providerInstanceId: result.containerName,
      hostname: result.hostname,
      privateIpv4: result.privateIpv4 ?? undefined,
      sshUsername: "root",
      sshPort: 22,
    });

    // Core VPS provisioning succeeded. Disarm rollback.
    createdId = undefined;
  } catch (error) {
    if (createdId) {
      try {
        await deleteVpsInstanceForProvisionRollback(createdId);
      } catch (cleanupError) {
        console.error("Manual VPS database rollback failed", cleanupError);
      }
    }
    console.error("Manual VPS provisioning failed", error);
    await interaction.editReply({
      content: `❌ VPS provisioning failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
    return;
  }

  // Build and deliver customer DM with full credentials and details
  let dmSent = false;
  try {
    const vpsNumberFormatted = String(provisioned.vpsNumber).padStart(6, "0");
    const instanceDisplayName = provisioned.instanceName ?? result.containerName;
    const pubHost = provisioned.publicSshHost || "ssh.mysticservers.com";
    const pubPort = provisioned.publicSshPort;
    const pubSshCommand = pubPort ? `ssh -p ${pubPort} root@${pubHost}` : "N/A";

    const locationEmoji =
      provisioned.location === "India"
        ? "🇮🇳"
        : provisioned.location === "Singapore"
          ? "🇸🇬"
          : provisioned.location === "Japan"
            ? "🇯🇵"
            : "🌐";

    const dmEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("🖥️ Your MysticServers VPS is Ready")
      .setDescription(`Hello ${user}! 👋\n\nYour MysticServers VPS **#${vpsNumberFormatted}** (\`${instanceDisplayName}\`) has been provisioned.`)
      .addFields(
        { name: "🖥️ VPS Number", value: `#${vpsNumberFormatted}`, inline: true },
        { name: "🏷️ Instance Name", value: instanceDisplayName, inline: true },
        { name: "🖥️ Hostname", value: provisioned.hostname, inline: true },
        { name: "📦 Plan", value: provisioned.planName, inline: true },
        { name: "📍 Location", value: `${locationEmoji} ${provisioned.location}`, inline: true },
        { name: "🧠 RAM", value: `${provisioned.ramGb} GB`, inline: true },
        { name: "⚡ vCore", value: `${provisioned.vcpu}`, inline: true },
        { name: "💾 Disk", value: `${provisioned.storageGb} GB`, inline: true },
        { name: "🧾 Billing", value: `${billingCycleMonths} month${billingCycleMonths === 1 ? "" : "s"}`, inline: true },
        {
          name: "📅 Expires",
          value: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(provisioned.expiresAt)),
          inline: true,
        },
        {
          name: "🌐 Public SSH Access",
          value:
            `🌐 **Host:** \`${pubHost}\`\n` +
            `🔌 **Port:** \`${pubPort ?? "N/A"}\`\n` +
            `👤 **Username:** \`root\`\n` +
            `🔑 **Password:** ||${password}||\n` +
            `🔗 **SSH Command:** \`${pubSshCommand}\``,
          inline: false,
        },
        {
          name: "🔒 Private Network",
          value:
            `🔒 **Private IPv4:** \`${result.privateIpv4 ?? "Not assigned"}\`\n` +
            `📡 **Internal Access:** Tailscale Subnet Router (10.0.3.0/24)`,
          inline: false,
        }
      )
      .setFooter({
        text: "MysticServers • Reliable infrastructure. Simple management.",
      })
      .setTimestamp();

    await user.send({
      embeds: [dmEmbed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`vps:terminal:generate:${Number(provisioned.vpsNumber)}`)
            .setLabel("Generate Terminal Session")
            .setEmoji("🖥️")
            .setStyle(ButtonStyle.Primary)
        ),
      ],
    });
    dmSent = true;
  } catch {
    /* customer DM availability does not alter provisioning */
  }

  const instanceDisplayName = provisioned.instanceName ?? result.containerName;
  const pubHost = provisioned.publicSshHost || "ssh.mysticservers.com";
  const pubPort = provisioned.publicSshPort;
  const pubSshCommand = pubPort ? `ssh -p ${pubPort} root@${pubHost}` : "N/A";

  await interaction.editReply({
    content:
      `✅ **VPS #${String(provisioned.vpsNumber).padStart(6, "0")} (${instanceDisplayName}) provisioned.**\n` +
      `Customer: ${user}\n` +
      `Instance Name: \`${instanceDisplayName}\`\n` +
      `Hostname: \`${provisioned.hostname}\`\n` +
      `Location: ${provisioned.location}\n` +
      `Resources: ${vcpu} vCPU • ${ramGb} GB RAM • ${storageGb} GB Disk\n` +
      `Public SSH: \`${pubHost}:${pubPort ?? "N/A"}\` (\`${pubSshCommand}\`)\n` +
      `Private IP: \`${result.privateIpv4 ?? "Not assigned"}\`\n` +
      `Status: ${provisioned.status}\n` +
      `Expiry: <t:${Math.floor(new Date(provisioned.expiresAt).getTime() / 1000)}:d>` +
      (dmSent ? "" : "\n⚠️ Customer DM failed — please deliver credentials manually."),
  });
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

  await interaction.deferReply({
    flags: 64,
  });

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
        "❌ We couldn't create your Sales ticket. Please try again or contact staff if the problem continues.",

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
// Customer VPS Terminal Access
// ============================================================

async function handleVpsTerminalButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const action = parts[2];
  const vpsNumber = Number(parts[3]);
  if (!Number.isInteger(vpsNumber) || vpsNumber < 1) {
    await interaction.reply({ content: "❌ Invalid VPS terminal request.", flags: 64 });
    return;
  }

  const vps = await getVpsByNumber(vpsNumber);
  if (!vps) {
    await interaction.reply({ content: "❌ VPS not found.", flags: 64 });
    return;
  }

  const customer = await getCustomerById(vps.customerId);
  if (!customer || customer.discordUserId !== interaction.user.id) {
    await interaction.reply({ content: "❌ You are not authorized to access this VPS terminal.", flags: 64 });
    return;
  }

  await interaction.deferReply({ flags: 64 });
  const containerName = vps.providerInstanceId || `mystic-vps-${String(vpsNumber).padStart(6, "0")}`;

  try {
    if (action === "close") {
      await closeVpsTerminalSession(containerName);
      await interaction.editReply({ content: "🔴 Your VPS terminal session has been closed." });
      return;
    }

    const session = action === "regenerate"
      ? await regenerateVpsTerminalSession(containerName)
      : await generateVpsTerminalSession(containerName);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`vps:terminal:regenerate:${vpsNumber}`).setLabel("Regenerate Terminal").setEmoji("🔄").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`vps:terminal:close:${vpsNumber}`).setLabel("Close Terminal").setEmoji("🔴").setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({
      content: `🖥️ **VPS #${String(vpsNumber).padStart(6, "0")} Terminal Session**\n\n🔐 **SSH**\n\`${session.sshCommand}\`\n\n🌐 **Web Terminal**\n${session.webUrl}\n\nKeep these details private. Regenerating the terminal invalidates the previous session.`,
      components: [buttons],
    });
  } catch (error) {
    console.error("VPS terminal session failed", error);
    await interaction.editReply({ content: `❌ Failed to manage the VPS terminal: ${error instanceof Error ? error.message : "Unknown error"}` });
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
  if (interaction.customId === "vps:provision") {
    await openVpsProvisionModal(interaction);
    return;
  }

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

function getTicketLogsChannel(guild: Guild): TextChannel | null {
  const configuredId = process.env.TICKET_LOG_CHANNEL_ID || process.env.TICKET_LOGS_CHANNEL_ID;
  if (configuredId) {
    const channel = guild.channels.cache.get(configuredId);
    if (channel instanceof TextChannel) {
      return channel;
    }
    console.warn(`[Ticket Logs] Configured TICKET_LOG_CHANNEL_ID "${configuredId}" was not found in guild or is not a text channel.`);
  }

  const channel = guild.channels.cache.find(
    (c) =>
      c instanceof TextChannel &&
      (c.name === "ticket-logs" ||
       c.name === "ticket_logs" ||
       c.name.endsWith("ticket-logs") ||
       c.name.includes("ticket-log"))
  );

  if (channel instanceof TextChannel) {
    return channel;
  }

  return null;
}

async function removeProvisionVpsButtonFromTicketChannel(
  channel: TextChannel
): Promise<void> {
  try {
    const messages = await channel.messages.fetch({ limit: 25 });
    for (const msg of messages.values()) {
      if (!msg.components || msg.components.length === 0) continue;

      let modified = false;
      const updatedRows: ActionRowBuilder<ButtonBuilder>[] = [];

      for (const row of msg.components) {
        if (!("components" in row) || !Array.isArray(row.components)) continue;
        const rowBuilder = new ActionRowBuilder<ButtonBuilder>();

        for (const c of row.components) {
          if (c.type === ComponentType.Button) {
            const btn = c as ButtonComponent;
            if (btn.customId === "vps:provision") {
              modified = true;
              continue;
            }
            rowBuilder.addComponents(ButtonBuilder.from(btn));
          }
        }

        if (rowBuilder.components.length > 0) {
          updatedRows.push(rowBuilder);
        }
      }

      if (modified) {
        await msg.edit({ components: updatedRows });
        console.log(`[VPS UI] Removed Provision VPS button from message ${msg.id} in channel ${channel.name}.`);
        break;
      }
    }
  } catch (err) {
    console.error("[VPS UI] Failed to remove Provision VPS button from ticket channel message:", err);
  }
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
    if (interaction.channel instanceof TextChannel) {
      await removeProvisionVpsButtonFromTicketChannel(interaction.channel);
    }
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

  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId(`vps:mode:${ticketId}:${billingCycleMonths}`)
    .setPlaceholder("Select provisioning method")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Automatic LXC Provisioning").setDescription("Create and configure a real LXC container automatically").setValue("automatic").setEmoji("⚡"),
      new StringSelectMenuOptionBuilder().setLabel("Manual Provisioning").setDescription("Use an existing VPS and enter its provider/network details").setValue("manual").setEmoji("🛠️")
    );
  await interaction.update({ content: "⚙️ **Select provisioning method.** Automatic provisioning creates the LXC on your VPS node. Manual provisioning keeps the existing workflow.", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeSelect)] });
}

async function handleVpsModeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!isStaffMember(interaction)) { await interaction.reply({content:"❌ Only Support Team members can provision VPS servers.",flags:64}); return; }
  const [, , ticketId, billingText] = interaction.customId.split(":");
  const billingCycleMonths = Number(billingText);
  const mode = interaction.values[0];
  if (mode === "manual") {
    const modal = new ModalBuilder().setCustomId(`vps:provision:network:${ticketId}:${billingCycleMonths}`).setTitle("Manual VPS Provisioning");
    const fields = [
      ["provider_instance_id","Provider / VPS ID","Example: 1042",true],
      ["hostname","Hostname","Example: mystic-vps-000001",true],
      ["public_ipv4","Public IPv4 (optional)","Leave blank if not assigned",false],
      ["private_ipv4","Private IPv4 (optional)","Leave blank if not assigned",false],
      ["ipv6","IPv6 (optional)","Leave blank if not assigned",false],
    ] as const;
    for (const [id,label,placeholder,required] of fields) modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(100)));
    await interaction.showModal(modal); return;
  }
  const modal = new ModalBuilder().setCustomId(`vps:provision:auto:${ticketId}:${billingCycleMonths}`).setTitle("Automatic LXC Provisioning");
  const hostname = new TextInputBuilder().setCustomId("hostname").setLabel("Hostname override (optional)").setPlaceholder("Leave blank for automatic hostname").setStyle(TextInputStyle.Short).setRequired(false);
  const ram = new TextInputBuilder().setCustomId("ram_gb").setLabel("RAM GB override (optional)").setPlaceholder("Leave blank to use plan RAM").setStyle(TextInputStyle.Short).setRequired(false);
  const cpu = new TextInputBuilder().setCustomId("vcpu").setLabel("vCPU override (optional)").setPlaceholder("Leave blank to use plan vCPU").setStyle(TextInputStyle.Short).setRequired(false);
  const disk = new TextInputBuilder().setCustomId("storage_gb").setLabel("Disk GB override (optional)").setPlaceholder("Leave blank to use plan disk").setStyle(TextInputStyle.Short).setRequired(false);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(hostname),new ActionRowBuilder<TextInputBuilder>().addComponents(ram),new ActionRowBuilder<TextInputBuilder>().addComponents(cpu),new ActionRowBuilder<TextInputBuilder>().addComponents(disk));
  await interaction.showModal(modal);
}

async function handleAutomaticVpsModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!interaction.guild || !isStaffMember(interaction)) {
    await interaction.reply({
      content: "❌ Only Support Team members can provision VPS servers.",
      flags: 64,
    });
    return;
  }

  const [, , , ticketId, billingText] = interaction.customId.split(":");
  const billingCycleMonths = Number(billingText);

  if (![1, 3, 6, 12].includes(billingCycleMonths)) {
    await interaction.reply({ content: "❌ Invalid billing cycle.", flags: 64 });
    return;
  }

  const ticket = await getTicketById(ticketId);
  const metadata = await getTicketCreatedMetadata(ticketId);

  if (!ticket || ticket.status === "closed" || !metadata?.planName || !metadata.location) {
    await interaction.reply({ content: "❌ This ticket cannot be provisioned.", flags: 64 });
    return;
  }

  if (await getVpsByTicketId(ticketId)) {
    await interaction.reply({ content: "⚠️ A VPS has already been provisioned for this ticket.", flags: 64 });
    return;
  }

  const num = (id: string, fallback: number): number => {
    const raw = interaction.fields.getTextInputValue(id).trim();

    if (!raw) {
      return fallback;
    }

    const value = Number(raw);

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${id} must be greater than zero.`);
    }

    return value;
  };

  await interaction.deferReply({ flags: 64 });

  let createdVpsId: string | undefined;
  let provisionedVps: VpsInstanceRecord;
  let password = "";
  let result: AutomaticVpsProvisionResult;

  try {
    const ramGb = num("ram_gb", Number(metadata.ramGb));
    const vcpu = num("vcpu", Number(metadata.vcpu));
    const storageGb = num("storage_gb", Number(metadata.storageGb));

    if (!Number.isInteger(vcpu)) {
      throw new Error("vCPU must be a whole number.");
    }

    const customer = await getCustomerById(ticket.customerId);
    if (!customer) {
      throw new Error("Customer record not found for ticket.");
    }

    const { instanceName, sequence } = await allocateAndBuildCustomerInstanceName(
      customer.id,
      customer.username,
      customer.discordUserId
    );

    const inputHostname = interaction.fields.getTextInputValue("hostname").trim();
    const hostname = inputHostname && inputHostname !== "pending" ? inputHostname : instanceName;
    password = generateSecureInitialPassword();

    const vps = await createVpsInstance({
      customerId: ticket.customerId,
      ticketId,
      instanceName,
      customerVpsSequence: sequence,
      planId: typeof metadata.planId === "string" ? metadata.planId : undefined,
      planName: String(metadata.planName),
      location: String(metadata.location),
      priceInr: Number(metadata.priceInr ?? 0),
      priceUsd: Number(metadata.priceUsd ?? 0),
      ramGb,
      vcpu,
      storageGb,
      providerInstanceId: instanceName,
      hostname,
      sshUsername: "root",
      sshPort: 22,
      provisionedByDiscordId: interaction.user.id,
      billingCycleMonths,
    });

    createdVpsId = vps.id;
    vps.vpsNumber = Number(vps.vpsNumber);

    if (!Number.isInteger(vps.vpsNumber) || vps.vpsNumber <= 0) {
      throw new Error(
        `Database returned an invalid VPS number: ${String(vps.vpsNumber)}`
      );
    }

    result = await provisionAutomaticVps({
      vpsNumber: vps.vpsNumber,
      containerName: instanceName,
      hostname,
      ramGb,
      vcpu,
      storageGb,
      initialPassword: password,
    });

    provisionedVps = await updateVpsProvisioningDetails({
      id: vps.id,
      providerInstanceId: result.containerName,
      hostname: result.hostname,
      privateIpv4: result.privateIpv4 ?? undefined,
      sshUsername: "root",
      sshPort: 22,
    });

    // Core VPS provisioning succeeded. Disarm rollback.
    createdVpsId = undefined;
  } catch (error) {
    console.error("Automatic VPS provisioning failed", error);

    if (createdVpsId) {
      try {
        await deleteVpsInstanceForProvisionRollback(createdVpsId);
      } catch (cleanupError) {
        console.error("Database rollback failed", cleanupError);
      }
    }

    await interaction.editReply({
      content: `❌ Automatic VPS provisioning failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
    return;
  }

  // Build and deliver VPS credentials & details to customer & staff
  const vpsNumberFormatted = String(provisionedVps.vpsNumber).padStart(6, "0");
  const instanceDisplayName = provisionedVps.instanceName ?? result.containerName;
  const pubHost = provisionedVps.publicSshHost || "ssh.mysticservers.com";
  const pubPort = provisionedVps.publicSshPort;
  const pubSshCommand = pubPort ? `ssh -p ${pubPort} root@${pubHost}` : "N/A";

  const customer = await getCustomerById(ticket.customerId);
  let dmSent = false;

  if (customer) {
    try {
      const user = await interaction.client.users.fetch(customer.discordUserId);

      const locationEmoji =
        provisionedVps.location === "India"
          ? "🇮🇳"
          : provisionedVps.location === "Singapore"
            ? "🇸🇬"
            : provisionedVps.location === "Japan"
              ? "🇯🇵"
              : "🌐";

      const dmEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🖥️ Your MysticServers VPS is Ready")
        .setDescription(
          `Hello <@${customer.discordUserId}>! 👋\n\n` +
            `Your VPS **#${vpsNumberFormatted}** (\`${instanceDisplayName}\`) has been provisioned automatically.`
        )
        .addFields(
          { name: "🖥️ VPS Number", value: `#${vpsNumberFormatted}`, inline: true },
          { name: "🏷️ Instance Name", value: instanceDisplayName, inline: true },
          { name: "🖥️ Hostname", value: provisionedVps.hostname, inline: true },
          { name: "📦 Plan", value: provisionedVps.planName, inline: true },
          { name: "📍 Location", value: `${locationEmoji} ${provisionedVps.location}`, inline: true },
          { name: "🧠 RAM", value: `${provisionedVps.ramGb} GB`, inline: true },
          { name: "⚡ vCore", value: `${provisionedVps.vcpu}`, inline: true },
          { name: "💾 Disk", value: `${provisionedVps.storageGb} GB`, inline: true },
          { name: "🧾 Billing", value: `${billingCycleMonths} month${billingCycleMonths === 1 ? "" : "s"}`, inline: true },
          {
            name: "📅 Expires",
            value: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(provisionedVps.expiresAt)),
            inline: true,
          },
          {
            name: "🌐 Public SSH Access",
            value:
              `🌐 **Host:** \`${pubHost}\`\n` +
              `🔌 **Port:** \`${pubPort ?? "N/A"}\`\n` +
              `👤 **Username:** \`root\`\n` +
              `🔑 **Password:** ||${password}||\n` +
              `🔗 **SSH Command:** \`${pubSshCommand}\``,
            inline: false,
          },
          {
            name: "🔒 Private Network",
            value:
              `🔒 **Private IPv4:** \`${result.privateIpv4 ?? "Not assigned"}\`\n` +
              `📡 **Internal Access:** Tailscale Subnet Router (10.0.3.0/24)`,
            inline: false,
          }
        )
        .setFooter({
          text: "MysticServers • Reliable infrastructure. Simple management.",
        })
        .setTimestamp();

      const terminalButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`vps:terminal:generate:${Number(provisionedVps.vpsNumber)}`)
          .setLabel("Generate Terminal Session")
          .setEmoji("🖥️")
          .setStyle(ButtonStyle.Primary)
      );

      await user.send({
        embeds: [dmEmbed],
        components: [terminalButtonRow],
      });
      dmSent = true;
    } catch (error) {
      console.error("Automatic VPS DM failed", error);
    }
  }

  await recordTicketEvent(ticketId, "vps_provisioned", interaction.user.id, {
    vpsId: provisionedVps.id,
    vpsNumber: provisionedVps.vpsNumber,
    providerInstanceId: result.containerName,
    instanceName: provisionedVps.instanceName ?? result.containerName,
    automatic: true,
    privateIpv4: result.privateIpv4,
    publicSshHost: pubHost,
    publicSshPort: pubPort,
    resources: { ramGb: provisionedVps.ramGb, vcpu: provisionedVps.vcpu, storageGb: provisionedVps.storageGb },
    dmSent,
  });

  await refreshVpsManagementDashboard(interaction.client);

  if (interaction.channel instanceof TextChannel) {
    await removeProvisionVpsButtonFromTicketChannel(interaction.channel);
  }

  await interaction.editReply({
    content: dmSent
      ? `✅ **VPS #${vpsNumberFormatted} (${instanceDisplayName}) provisioned automatically.**\n` +
        `Customer: <@${ticket.customerId}>\n` +
        `Instance Name: \`${instanceDisplayName}\`\n` +
        `Hostname: \`${provisionedVps.hostname}\`\n` +
        `Resources: ${provisionedVps.vcpu} vCPU • ${provisionedVps.ramGb} GB RAM • ${provisionedVps.storageGb} GB Disk\n` +
        `Public SSH: \`${pubHost}:${pubPort ?? "N/A"}\` (\`${pubSshCommand}\`)\n` +
        `Private IP: \`${result.privateIpv4 ?? "Not assigned"}\`\n` +
        `Status: ${provisionedVps.status}\n` +
        `VPS details and credentials delivered to customer via DM.`
      : `⚠️ **VPS #${vpsNumberFormatted} (${instanceDisplayName}) provisioned automatically.**\n` +
        `Customer: <@${ticket.customerId}>\n` +
        `Instance Name: \`${instanceDisplayName}\`\n` +
        `Hostname: \`${provisionedVps.hostname}\`\n` +
        `Public SSH: \`${pubHost}:${pubPort ?? "N/A"}\` (\`${pubSshCommand}\`)\n` +
        `Private IP: \`${result.privateIpv4 ?? "Not assigned"}\`\n` +
        `Password: ||${password}||\n` +
        `Customer DM failed — please deliver credentials manually.`,
  });

  // Isolated optional terminal generation step (post-provisioning success)
  try {
    await generateVpsTerminalSession(provisionedVps.providerInstanceId);
  } catch (terminalError) {
    console.error(
      `VPS #${provisionedVps.vpsNumber} provisioned successfully but terminal generation failed:`,
      terminalError
    );
  }
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

    if (interaction.channel instanceof TextChannel) {
      await removeProvisionVpsButtonFromTicketChannel(interaction.channel);
    }

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

  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply();
  }

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

    await interaction.message.edit({
      components: interaction.message.components.map((row) => {
        if (!("components" in row)) {
          return row.toJSON();
        }

        return {
          type: row.type,
          components: row.components
            .filter(
              (component) =>
                !("customId" in component) ||
                component.customId !== "ticket:claim"
            )
            .map((component) => component.toJSON()),
        };
      }),
    });

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
    // Send log embed and transcript attachment to #ticket-logs
    // --------------------------------------------------------

    let logSent = false;
    let logErrorReason: string | null = null;
    const paddedTicketNum = String(ticket.ticketNumber).padStart(6, "0");

    const logChannel = getTicketLogsChannel(interaction.guild!);

    if (!logChannel) {
      logErrorReason = "#ticket-logs channel was not found in server.";
      console.warn(`[Ticket Logs] ${logErrorReason}`);
    } else {
      const botMember = interaction.guild!.members.me;
      const missingPerms: string[] = [];

      if (botMember) {
        const perms = logChannel.permissionsFor(botMember);
        if (!perms?.has(PermissionFlagsBits.ViewChannel)) missingPerms.push("ViewChannel");
        if (!perms?.has(PermissionFlagsBits.SendMessages)) missingPerms.push("SendMessages");
        if (!perms?.has(PermissionFlagsBits.EmbedLinks)) missingPerms.push("EmbedLinks");
        if (!perms?.has(PermissionFlagsBits.AttachFiles)) missingPerms.push("AttachFiles");
      }

      if (missingPerms.length > 0) {
        logErrorReason = `Bot lacks permissions in #${logChannel.name}: ${missingPerms.join(", ")}`;
        console.error(`[Ticket Logs] ${logErrorReason}`);
      } else {
        try {
          const customer = await getCustomerById(existingTicket.customerId);
          let customerUser: User | null = null;
          if (customer) {
            customerUser = await interaction.client.users.fetch(customer.discordUserId).catch(() => null);
          }

          const logEmbed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle(`📁 Ticket Closed — #${paddedTicketNum}`)
            .addFields(
              { name: "🎫 Ticket Number", value: `#${paddedTicketNum}`, inline: true },
              { name: "📋 Department", value: existingTicket.department ? existingTicket.department.toUpperCase() : "GENERAL", inline: true },
              { name: "🔴 Status", value: "Closed", inline: true },
              { name: "👤 Customer", value: customerUser ? `${customerUser} (\`${customerUser.tag}\` / \`${customerUser.id}\`)` : `ID: \`${existingTicket.customerId}\``, inline: false },
              { name: "👮 Claimed By", value: existingTicket.claimedByDiscordId ? `<@${existingTicket.claimedByDiscordId}> (\`${existingTicket.claimedByDiscordId}\`)` : "Unclaimed", inline: true },
              { name: "🔒 Closed By", value: `${member.user} (\`${member.user.tag}\` / \`${member.user.id}\`)`, inline: true },
              { name: "🆔 Ticket Database ID", value: `\`${ticket.id}\``, inline: false }
            )
            .setFooter({ text: "MysticServers Support • Ticket Archival" })
            .setTimestamp();

          const files: AttachmentBuilder[] = [];
          if (transcriptPath && fsSync.existsSync(transcriptPath)) {
            files.push(new AttachmentBuilder(transcriptPath, { name: path.basename(transcriptPath) }));
          }

          await logChannel.send({
            embeds: [logEmbed],
            files,
          });
          logSent = true;
          console.log(`[Ticket Logs] Ticket #${paddedTicketNum} log & transcript archived to #${logChannel.name}.`);
        } catch (logErr: any) {
          logErrorReason = logErr?.message || "Failed to post log embed to ticket-logs channel.";
          console.error(`[Ticket Logs] Error delivering closed ticket log to #${logChannel.name}:`, logErr);
        }
      }
    }

    // --------------------------------------------------------
    // Closing response & channel notification
    // --------------------------------------------------------

    await interaction.editReply({
      content:
        `🔒 **Ticket closing...**\n\n` +
        `🔴 **Status:** Closed\n` +
        `👤 **Closed by:** ${member}\n\n` +
        (
          transcriptPath
            ? "📄 **Transcript:** Generated successfully.\n"
            : "⚠️ **Transcript:** Could not be generated.\n"
        ) +
        (
          logSent
            ? `📁 **Ticket Log:** Archived to <#${logChannel?.id}>.\n\n`
            : `⚠️ **Ticket Log:** Could not be archived (${logErrorReason || "Unknown error"}).\n\n`
        ) +
        "This ticket will be deleted shortly.",
    });

    await channel.send({
      content:
        `🔒 **Ticket closed**\n\n` +
        `🔴 **Status:** Closed\n` +
        `👤 **Closed by:** ${member}\n` +
        `🎫 **Ticket:** #${paddedTicketNum}\n\n` +
        (
          transcriptPath
            ? "📄 Transcript saved successfully.\n"
            : "⚠️ Transcript generation failed.\n"
        ) +
        (
          logSent
            ? `📁 Log archived to <#${logChannel?.id}>.\n\n`
            : `⚠️ Log archival failed (${logErrorReason || "Unknown error"}).\n\n`
        ) +
        "This channel will be removed shortly.",
    });

    console.log(
      `🔒 Ticket #${paddedTicketNum} closed by ${member.user.tag}`
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

// ============================================================
// Minecraft Hosting Interaction Handlers
// ============================================================

async function handleCustomerMinecraftCommand(
  interaction: ChatInputCommandInteraction,
  isStaff: boolean
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "plans") {
    const panel = await createMinecraftPricingPanel();
    await interaction.reply({ ...panel });
    return;
  }

  if (subcommand === "servers") {
    await interaction.deferReply({ flags: 64 });

    try {
      const servers = await listMinecraftServersByDiscordUserId(interaction.user.id);

      if (servers.length === 0) {
        await interaction.editReply({
          content:
            "🎮 **Your Minecraft Servers**\n\n" +
            "You don't have any Minecraft servers yet.\n\n" +
            "You can purchase one using:\n`/minecraft plans`",
        });
        return;
      }

      const formatDate = (d: Date) =>
        new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        }).format(new Date(d));

      const formatStatus = (s: string, expiresAt: Date) => {
        const norm = s.toLowerCase();
        if (norm === "suspended") return "🟡 Suspended";
        if (norm === "expired" || new Date(expiresAt).getTime() <= Date.now()) return "🔴 Expired";
        return "🟢 Active";
      };

      const serverEntries = servers.map((server) => {
        const statusStr = formatStatus(server.status, server.expiresAt);
        const expiryStr = formatDate(server.expiresAt);
        const expiryUnix = Math.floor(new Date(server.expiresAt).getTime() / 1000);
        const ramGb = (server.ramMb / 1024).toFixed(0);
        const storageGb = (server.storageMb / 1024).toFixed(0);

        return (
          `**${statusStr.split(" ")[0]} ${server.serverName}**\n` +
          `📦 **Plan:** ${server.planName}\n` +
          `🧠 **RAM:** ${ramGb} GB\n` +
          `⚡ **CPU:** ${server.cpuLimit}%\n` +
          `💾 **Storage:** ${storageGb} GB\n` +
          `🌐 **Address:** \`${server.customerHostname}:${server.allocationPort}\`\n` +
          `📊 **Status:** ${statusStr}\n` +
          `📅 **Expires:** ${expiryStr} (<t:${expiryUnix}:R>)`
        );
      });

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🎮 Your Minecraft Servers")
        .setDescription(serverEntries.join("\n\n━━━━━━━━━━━━━━━━━━━━\n\n"))
        .setFooter({ text: "MysticServers • Minecraft Hosting" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("[Minecraft Command] Failed to fetch customer Minecraft servers:", error);
      await interaction.editReply({ content: "❌ Unable to retrieve Minecraft server information right now." });
    }
    return;
  }

  if (subcommand === "info") {
    if (!isStaff) {
      await interaction.reply({
        content: "❌ This command is only available to the MysticServers Support Team.",
        flags: 64,
      });
      return;
    }

    const targetUser = interaction.options.getUser("user", true);
    await interaction.deferReply({ flags: 64 });

    try {
      const servers = await listMinecraftServersByDiscordUserId(targetUser.id);

      if (servers.length === 0) {
        await interaction.editReply({
          content: `ℹ️ No Minecraft hosting records found for customer ${targetUser} (\`${targetUser.id}\`).`,
        });
        return;
      }

      const formatDate = (d: Date) =>
        new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        }).format(new Date(d));

      const formatStatus = (s: string, expiresAt: Date) => {
        const norm = s.toLowerCase();
        if (norm === "suspended") return "🟡 Suspended";
        if (norm === "expired" || new Date(expiresAt).getTime() <= Date.now()) return "🔴 Expired";
        return "🟢 Active";
      };

      const serverEntries = servers.map((server) => {
        const statusStr = formatStatus(server.status, server.expiresAt);
        const expiryStr = formatDate(server.expiresAt);
        const expiryUnix = Math.floor(new Date(server.expiresAt).getTime() / 1000);
        const ramGb = (server.ramMb / 1024).toFixed(0);
        const storageGb = (server.storageMb / 1024).toFixed(0);
        const duration = server.billingCycleMonths ?? 1;

        return (
          `**${statusStr.split(" ")[0]} ${server.serverName}**\n\n` +
          `📦 **Plan:** ${server.planName}\n` +
          `⚡ **CPU:** ${server.cpuLimit}%\n` +
          `🧠 **RAM:** ${ramGb} GB\n` +
          `💾 **Storage:** ${storageGb} GB\n` +
          `🌐 **Address:** \`${server.customerHostname}:${server.allocationPort}\`\n` +
          `📊 **Status:** ${statusStr}\n` +
          `🧾 **Billing:** ${duration} Month${duration === 1 ? "" : "s"}\n` +
          `📅 **Expires:** ${expiryStr} (<t:${expiryUnix}:R>)`
        );
      });

      const pteroUserId = servers[0]?.pterodactylUserId;

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🎮 Minecraft Hosting Information")
        .setDescription(
          `👤 **Customer:** ${targetUser} (${targetUser.username})\n` +
            `🆔 **Discord ID:** \`${targetUser.id}\`\n` +
            `🎛️ **Pterodactyl User ID:** \`${pteroUserId ?? "N/A"}\`\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `**SERVERS (${servers.length})**\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            serverEntries.join("\n\n━━━━━━━━━━━━━━━━━━━━\n\n")
        )
        .setFooter({ text: "MysticServers Staff • Minecraft Management" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("[Minecraft Command] Staff info lookup failed:", error);
      await interaction.editReply({ content: "❌ Unable to retrieve Minecraft server information right now." });
    }
  }
}

async function handleMinecraftCreateCommand(
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

  const user = interaction.options.getUser("user", true);
  const planId = interaction.options.getString("plan", true);
  const billingCycleMonths = interaction.options.getInteger("billing_months") ?? 1;

  await interaction.deferReply({ flags: 64 });

  try {
    const customer = await getOrCreateCustomer(user.id, user.username, user.globalName ?? user.username);

    const result = await provisionMinecraftServer({
      customerId: customer.id,
      discordUserId: user.id,
      discordUsername: user.username,
      discordDisplayName: user.globalName ?? user.username,
      planId,
      billingCycleMonths,
      provisionedByDiscordId: interaction.user.id,
    });

    let dmSent = false;
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🎮 Your Minecraft Server is Ready!")
        .setDescription(`Hello ${user}! 👋\n\nYour Minecraft server **${result.serverRecord.serverName}** has been provisioned.`)
        .addFields(
          { name: "🏷️ Server Name", value: result.serverRecord.serverName, inline: true },
          { name: "📦 Plan", value: result.plan.name, inline: true },
          { name: "🧠 RAM", value: `${result.plan.ramGb} GB`, inline: true },
          { name: "⚡ CPU", value: `${result.plan.cpuPercent}%`, inline: true },
          { name: "💾 Storage", value: `${result.plan.storageGb} GB`, inline: true },
          { name: "🧾 Billing", value: `${billingCycleMonths} month${billingCycleMonths === 1 ? "" : "s"}`, inline: true },
          {
            name: "🎮 Connection Address",
            value: `\`${result.connectionAddress}\`\n*(Enter this address into Minecraft Java Edition)*`,
            inline: false,
          },
          {
            name: "🎛️ Pterodactyl Panel Credentials",
            value:
              `🌐 **Panel URL:** \`https://panel.mysticservers.com\`\n` +
              `👤 **Username:** \`${result.pterodactylUser.username}\`\n` +
              (result.initialPassword ? `🔑 **Password:** ||${result.initialPassword}||\n` : "") +
              `*(Use these credentials to log in to the Pterodactyl Web Panel)*`,
            inline: false,
          }
        )
        .setFooter({ text: "MysticServers • Minecraft Hosting" })
        .setTimestamp();

      await user.send({ embeds: [dmEmbed] });
      dmSent = true;
    } catch {
      /* customer DM failure handled gracefully */
    }

    await interaction.editReply({
      content:
        `✅ **Minecraft Server #${String(result.serverRecord.serverNumber).padStart(6, "0")} (${result.serverRecord.serverName}) provisioned successfully.**\n` +
        `Customer: ${user}\n` +
        `Plan: ${result.plan.name}\n` +
        `Address: \`${result.connectionAddress}\`\n` +
        `Pterodactyl User: \`${result.pterodactylUser.username}\` (ID: ${result.pterodactylUser.id})\n` +
        (dmSent ? "Server credentials delivered via DM." : "⚠️ Customer DM failed — please deliver credentials manually."),
    });
  } catch (error) {
    console.error("Manual Minecraft server provisioning failed", error);
    await interaction.editReply({
      content: `❌ Minecraft provisioning failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

async function handleMinecraftPlanSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const selectedPlanId = interaction.values[0]?.replace("minecraft:plan:", "");
  if (!selectedPlanId) {
    await interaction.reply({ content: "❌ Invalid plan selection.", flags: 64 });
    return;
  }

  const planDetails = await createMinecraftPlanDetails(selectedPlanId, 1);
  await interaction.reply({
    embeds: [planDetails.embed],
    components: planDetails.components,
    flags: 64,
  });
}

async function handleMinecraftDurationSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const value = interaction.values[0];
  const parts = value?.split(":");
  if (!parts || parts.length < 4) {
    await interaction.reply({ content: "❌ Invalid duration selection.", flags: 64 });
    return;
  }

  const planId = parts[2];
  const months = parseInt(parts[3], 10) || 1;

  const planDetails = await createMinecraftPlanDetails(planId, months);
  await interaction.update({
    embeds: [planDetails.embed],
    components: planDetails.components,
  });
}

async function handleMinecraftButton(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === "minecraft:back:plans") {
    const panel = await createMinecraftPricingPanel();
    await interaction.update({
      embeds: panel.embeds,
      components: panel.components,
    });
    return;
  }

  if (interaction.customId.startsWith("minecraft:create_ticket:")) {
    const parts = interaction.customId.split(":");
    const planId = parts[2];
    const billingMonths = parseInt(parts[3], 10) || 1;

    const plan = getMinecraftPlanById(planId);

    if (!plan) {
      await interaction.reply({ content: "❌ Selected Minecraft plan no longer exists.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const guild = interaction.guild;
      const member = interaction.guild?.members.cache.get(interaction.user.id) ||
        (await interaction.guild?.members.fetch(interaction.user.id));

      if (!guild || !member) {
        await interaction.editReply({ content: "❌ Ticket creation can only be performed inside the MysticServers Discord server." });
        return;
      }

      const channel = await createTicket(
        guild,
        member,
        "sales",
        undefined,
        {
          planId: plan.id,
          planName: plan.name,
          billingMonths,
          monthlyPriceInr: plan.priceInr,
          monthlyPriceUsd: plan.priceUsd,
          priceInr: plan.priceInr * billingMonths,
          priceUsd: plan.priceUsd * billingMonths,
          ramGb: plan.ramGb,
          cpuPercent: plan.cpuPercent,
          storageGb: plan.storageGb,
        }
      );

      await interaction.editReply({
        content: `✅ Ticket created! Please head to ${channel} to finalize your Minecraft server order.`,
      });
    } catch (error) {
      console.error("Failed to create Minecraft ticket:", error);
      await interaction.editReply({ content: `❌ Ticket creation failed: ${error instanceof Error ? error.message : "Unknown error"}` });
    }
    return;
  }

  if (interaction.customId === "minecraft:provision") {
    await handleMinecraftProvisionTicketButton(interaction);
    return;
  }
}

async function handleMinecraftProvisionTicketButton(interaction: ButtonInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: "❌ Provisioning can only be initiated inside a ticket channel.", flags: 64 });
    return;
  }

  const topic = channel.topic || "";
  const ticketIdMatch = topic.match(/ticket-id:([a-f0-9-]+)/i);

  if (!ticketIdMatch) {
    await interaction.reply({ content: "❌ Unable to locate ticket ID from channel metadata.", flags: 64 });
    return;
  }

  const ticketId = ticketIdMatch[1];
  const ticket = await getTicketById(ticketId);

  if (!ticket || ticket.status === "closed") {
    await interaction.reply({ content: "❌ Ticket is closed or invalid.", flags: 64 });
    return;
  }

  // Idempotency check: prevent duplicate provisioning for the same ticket!
  const existingMcServer = await getMinecraftServerByTicketId(ticketId);
  if (existingMcServer) {
    await interaction.reply({
      content: `⚠️ A Minecraft server (**#${String(existingMcServer.serverNumber).padStart(6, "0")} — ${existingMcServer.serverName}**) has already been provisioned for this ticket.`,
      flags: 64,
    });
    return;
  }

  const metadata = await getTicketCreatedMetadata(ticketId);
  const planId = (metadata?.planId as string) || (metadata?.minecraftDetails as any)?.planId;
  const billingMonths = Number((metadata?.billingMonths as number) || (metadata?.minecraftDetails as any)?.billingMonths || 1);

  if (!planId) {
    await interaction.reply({ content: "❌ No Minecraft plan configuration found attached to this ticket.", flags: 64 });
    return;
  }

  const plan = getMinecraftPlanById(planId);
  if (!plan) {
    await interaction.reply({ content: `❌ Minecraft plan "${planId}" attached to ticket is invalid.`, flags: 64 });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  try {
    const customer = await getCustomerById(ticket.customerId);
    if (!customer) {
      throw new Error("Customer record not found for ticket.");
    }

    const discordUser = await interaction.client.users.fetch(customer.discordUserId);

    const result = await provisionMinecraftServer({
      customerId: customer.id,
      discordUserId: customer.discordUserId,
      discordUsername: customer.username || discordUser.username,
      discordDisplayName: customer.displayName || discordUser.globalName || discordUser.username,
      planId: plan.id,
      billingCycleMonths: billingMonths,
      provisionedByDiscordId: interaction.user.id,
      ticketId: ticket.id,
    });

    let dmSent = false;
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🎮 Your Minecraft Server is Ready!")
        .setDescription(`Hello <@${customer.discordUserId}>! 👋\n\nYour Minecraft server **${result.serverRecord.serverName}** has been provisioned automatically.`)
        .addFields(
          { name: "🏷️ Server Name", value: result.serverRecord.serverName, inline: true },
          { name: "📦 Plan", value: result.plan.name, inline: true },
          { name: "🧠 RAM", value: `${result.plan.ramGb} GB`, inline: true },
          { name: "⚡ CPU", value: `${result.plan.cpuPercent}%`, inline: true },
          { name: "💾 Storage", value: `${result.plan.storageGb} GB`, inline: true },
          {
            name: "🎮 Connection Address",
            value: `\`${result.connectionAddress}\`\n*(Enter this address into Minecraft Java Edition)*`,
            inline: false,
          },
          {
            name: "🎛️ Pterodactyl Panel Credentials",
            value:
              `🌐 **Panel URL:** \`https://panel.mysticservers.com\`\n` +
              `👤 **Username:** \`${result.pterodactylUser.username}\`\n` +
              (result.initialPassword ? `🔑 **Password:** ||${result.initialPassword}||\n` : "") +
              `*(Use these credentials to log in to the Pterodactyl Web Panel)*`,
            inline: false,
          }
        )
        .setFooter({ text: "MysticServers • Minecraft Hosting" })
        .setTimestamp();

      await discordUser.send({ embeds: [dmEmbed] });
      dmSent = true;
    } catch {
      /* DM error handled gracefully */
    }

    await recordTicketEvent(ticketId, "minecraft_server_provisioned", interaction.user.id, {
      minecraftServerId: result.serverRecord.id,
      serverNumber: result.serverRecord.serverNumber,
      pterodactylServerId: result.pterodactylServer.id,
      connectionAddress: result.connectionAddress,
      dmSent,
    });

    await interaction.editReply({
      content:
        `✅ **Minecraft Server #${String(result.serverRecord.serverNumber).padStart(6, "0")} (${result.serverRecord.serverName}) provisioned.**\n` +
        `Customer: <@${customer.discordUserId}>\n` +
        `Address: \`${result.connectionAddress}\`\n` +
        `Pterodactyl User: \`${result.pterodactylUser.username}\`\n` +
        (dmSent ? "Server details delivered to customer via DM." : "⚠️ Customer DM failed — please deliver credentials manually."),
    });
  } catch (error) {
    console.error("Ticket Minecraft server provisioning failed", error);
    await interaction.editReply({
      content: `❌ Minecraft provisioning failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

// ============================================================
// Staff VPS Deletion Handler
// ============================================================

async function handleVpsDeleteCommand(
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

  const numberOpt = interaction.options.getInteger("number");
  const userOpt = interaction.options.getUser("user");

  if (!numberOpt && !userOpt) {
    await interaction.reply({
      content: "❌ Please specify either a VPS number (`number:<VPS number>`) or a customer (`user:<Discord user>`).",
      flags: 64,
    });
    return;
  }

  if (numberOpt) {
    await interaction.deferReply({ flags: 64 });
    const vps = await getVpsByNumber(numberOpt);
    if (!vps) {
      await interaction.editReply({ content: `❌ VPS #${String(numberOpt).padStart(6, "0")} was not found.` });
      return;
    }

    if (vps.status === "deleted") {
      await interaction.editReply({ content: `ℹ️ VPS #${String(numberOpt).padStart(6, "0")} is already deleted/decommissioned.` });
      return;
    }

    const { embed, components } = renderVpsDeleteConfirmationEmbed(vps, interaction.user.id);
    await interaction.editReply({ embeds: [embed], components });
    return;
  }

  if (userOpt) {
    await interaction.deferReply({ flags: 64 });
    const vpsInstances = await listVpsByDiscordUserId(userOpt.id);
    const activeInstances = vpsInstances.filter((vps) => vps.status !== "deleted");

    if (activeInstances.length === 0) {
      await interaction.editReply({
        content: `ℹ️ No active VPS instances found for customer ${userOpt} (\`${userOpt.id}\`).`,
      });
      return;
    }

    if (activeInstances.length === 1) {
      const { embed, components } = renderVpsDeleteConfirmationEmbed(activeInstances[0], interaction.user.id);
      await interaction.editReply({ embeds: [embed], components });
      return;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`vps:delete:select:${interaction.user.id}`)
      .setPlaceholder("Select a VPS to delete...")
      .addOptions(
        activeInstances.map((vps) => {
          const numFmt = String(vps.vpsNumber).padStart(6, "0");
          const instanceDisplayName = vps.instanceName || vps.providerInstanceId;
          const expiryStr = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(vps.expiresAt));

          return new StringSelectMenuOptionBuilder()
            .setLabel(`#${numFmt} • ${instanceDisplayName}`)
            .setDescription(`${vps.vcpu} vCPU / ${vps.ramGb}GB RAM / ${vps.storageGb}GB Disk • Exp: ${expiryStr}`)
            .setValue(vps.id);
        })
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.editReply({
      content: `🗑️ **Delete VPS**\n\nCustomer: ${userOpt} (\`${userOpt.id}\`)\n\nSelect the VPS you want to delete:`,
      components: [row],
    });
  }
}

function renderVpsDeleteConfirmationEmbed(
  vps: VpsInstanceRecord,
  staffUserId: string
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
  const vpsNumFormatted = String(vps.vpsNumber).padStart(6, "0");
  const instanceDisplayName = vps.instanceName || vps.providerInstanceId;
  const pubHost = vps.publicSshHost || "ssh.mysticservers.com";
  const pubPort = vps.publicSshPort;
  const expiryStr = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(vps.expiresAt));

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚠️ Confirm Permanent VPS Deletion")
    .setDescription(
      `**WARNING:** This action will permanently destroy the LXC container and release its public SSH port allocation.\n\n` +
        `🖥️ **VPS Number:** \`#${vpsNumFormatted}\`\n` +
        `🏷️ **Instance Name:** \`${instanceDisplayName}\`\n` +
        `🖥️ **Hostname:** \`${vps.hostname}\`\n\n` +
        `📊 **Resources:** ${vps.vcpu} vCPU • ${vps.ramGb} GB RAM • ${vps.storageGb} GB Disk\n` +
        `🔒 **Private IPv4:** \`${vps.privateIpv4 ?? "Not assigned"}\`\n` +
        `🌐 **Public SSH:** \`${pubHost}:${pubPort ?? "N/A"}\` (\`ssh -p ${pubPort} root@${pubHost}\`)\n` +
        `📅 **Expires:** ${expiryStr}`
    )
    .setFooter({ text: "MysticServers Staff • Destructive Action Warning" })
    .setTimestamp();

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`vps:delete:confirm:${vps.id}:${staffUserId}`)
      .setLabel("🔴 Delete VPS")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`vps:delete:cancel:${staffUserId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, components: [confirmRow] };
}

async function handleVpsDeleteSelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const [, , , initiatingStaffId] = interaction.customId.split(":");
  if (interaction.user.id !== initiatingStaffId) {
    await interaction.reply({
      content: `❌ Only the staff member who initiated this command (<@${initiatingStaffId}>) can select a VPS.`,
      flags: 64,
    });
    return;
  }

  const selectedVpsId = interaction.values[0];
  const vps = await getVpsById(selectedVpsId);

  if (!vps || vps.status === "deleted") {
    await interaction.reply({
      content: "❌ The selected VPS is no longer active.",
      flags: 64,
    });
    return;
  }

  const { embed, components } = renderVpsDeleteConfirmationEmbed(vps, interaction.user.id);
  await interaction.update({
    content: null,
    embeds: [embed],
    components,
  });
}

async function handleVpsDeleteButton(
  interaction: ButtonInteraction
): Promise<void> {
  const parts = interaction.customId.split(":");
  const action = parts[2];

  if (action === "cancel") {
    const initiatingStaffId = parts[3];
    if (interaction.user.id !== initiatingStaffId) {
      await interaction.reply({
        content: `❌ Only the staff member who initiated this command (<@${initiatingStaffId}>) can cancel.`,
        flags: 64,
      });
      return;
    }

    await interaction.update({
      content: "ℹ️ VPS deletion cancelled.",
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === "confirm") {
    const vpsId = parts[3];
    const initiatingStaffId = parts[4];

    if (interaction.user.id !== initiatingStaffId) {
      await interaction.reply({
        content: `❌ Only the staff member who initiated this command (<@${initiatingStaffId}>) can confirm deletion.`,
        flags: 64,
      });
      return;
    }

    await interaction.deferUpdate();

    const vps = await getVpsById(vpsId);
    if (!vps || vps.status === "deleted") {
      await interaction.editReply({
        content: "❌ This VPS is already deleted or no longer exists.",
        embeds: [],
        components: [],
      });
      return;
    }

    const containerName = vps.providerInstanceId;
    const vpsNumFmt = String(vps.vpsNumber).padStart(6, "0");
    const instanceDisplayName = vps.instanceName || containerName;
    const releasedPort = vps.publicSshPort ?? "None";

    try {
      await destroyVpsNodeContainer(containerName);
    } catch (lxcError: any) {
      console.error(`[VPS Delete] Failed to destroy LXC container "${containerName}":`, lxcError);
      const isMissing = lxcError?.message?.includes("does not exist") || lxcError?.message?.includes("no such container");
      if (!isMissing) {
        await interaction.editReply({
          content: `❌ Failed to destroy LXC container \`${containerName}\`: ${lxcError?.message || "Unknown error"}. Database state was NOT changed.`,
          embeds: [],
          components: [],
        });
        return;
      }
    }

    const decommissioned = await decommissionVpsInstance(vps.id);
    if (!decommissioned) {
      await interaction.editReply({
        content: `⚠️ LXC container \`${containerName}\` was destroyed, but database finalization failed. Please verify database record.`,
        embeds: [],
        components: [],
      });
      return;
    }

    let dmSent = false;
    try {
      const customer = await getCustomerById(vps.customerId);
      if (customer) {
        const user = await interaction.client.users.fetch(customer.discordUserId);

        const dmEmbed = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🗑️ VPS Decommissioned")
          .setDescription(
            `Hello <@${customer.discordUserId}>! 👋\n\n` +
              `Your VPS **#${vpsNumFmt}** (\`${instanceDisplayName}\`) has been permanently decommissioned by MysticServers support.\n\n` +
              `Public SSH access and container resources have been shut down and removed.`
          )
          .setFooter({ text: "MysticServers • VPS Management" })
          .setTimestamp();

        await user.send({ embeds: [dmEmbed] });
        dmSent = true;
      }
    } catch (dmErr) {
      console.error(`[VPS Delete] Customer DM failed for VPS #${vps.vpsNumber}:`, dmErr);
    }

    await refreshVpsManagementDashboard(interaction.client);

    await interaction.editReply({
      content:
        `✅ **VPS #${vpsNumFmt} (${instanceDisplayName}) deleted successfully.**\n\n` +
        `🏷️ **Instance:** \`${instanceDisplayName}\`\n` +
        `🔌 **Public SSH Port:** \`${releasedPort}\` released for reuse\n` +
        `📦 **LXC Container:** Destroyed\n` +
        `📊 **Database Status:** Marked as \`deleted\`\n` +
        (dmSent ? "📩 Customer notified via DM." : "⚠️ Customer DM failed or not available."),
      embeds: [],
      components: [],
    });
  }
}
