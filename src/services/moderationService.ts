import {
  EmbedBuilder,
  Guild,
  Message,
  PermissionFlagsBits,
} from "discord.js";

import { detectMessageContent } from "../moderation/moderationRules";
import { ModerationDetection } from "../moderation/moderationTypes";
import {
  getModerationUserState,
  isModerationWhitelisted,
  recordModerationEvent,
} from "./moderationDatabase";

const LOG_CHANNEL_NAME = "🔐・moderation-logs";

function getSeverityEmoji(severity: ModerationDetection["severity"]): string {
  if (severity === "critical") return "🔴";
  if (severity === "high") return "🟠";
  if (severity === "medium") return "🟡";
  return "🟢";
}

async function findModerationLogChannel(guild: Guild) {
  const configured = process.env.MODERATION_LOG_CHANNEL_ID;
  if (configured) {
    const channel = guild.channels.cache.get(configured);
    if (channel?.isTextBased()) return channel;
  }

  const channel = guild.channels.cache.find(
    (item) => item.isTextBased() && item.name === LOG_CHANNEL_NAME
  );

  return channel?.isTextBased() ? channel : null;
}

async function logModerationEvent(
  message: Message,
  detection: ModerationDetection,
  action: string,
  violationCount: number,
  warningCount: number
): Promise<void> {
  const channel = await findModerationLogChannel(message.guild!);
  if (!channel || !channel.isSendable()) {
    console.warn(
      `⚠️ Moderation log channel not found in ${message.guild?.name ?? "guild"}. ` +
      `Create ${LOG_CHANNEL_NAME} or set MODERATION_LOG_CHANNEL_ID.`
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${getSeverityEmoji(detection.severity)} Moderation Alert`)
    .setDescription(detection.reason)
    .addFields(
      {
        name: "👤 User",
        value: `${message.author} (${message.author.id})`,
        inline: true,
      },
      {
        name: "📍 Channel",
        value: `<#${message.channelId}>`,
        inline: true,
      },
      {
        name: "📊 Severity",
        value: detection.severity.toUpperCase(),
        inline: true,
      },
      {
        name: "🏷️ Rule",
        value: detection.rule,
        inline: true,
      },
      {
        name: "🤖 Action",
        value: action,
        inline: true,
      },
      {
        name: "📈 User history",
        value: `Violations: **${violationCount}**\nWarnings: **${warningCount}**`,
        inline: true,
      },
      {
        name: "🔗 Message",
        value: `[Jump to message](https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id})`,
        inline: true,
      },
      {
        name: "📝 Message snapshot",
        value: message.content.slice(0, 1000) || "[No text content]",
        inline: false,
      }
    )
    .setFooter({ text: "MysticServers Guard" })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

async function deleteMessage(message: Message): Promise<boolean> {
  try {
    await message.delete();
    return true;
  } catch (error) {
    console.error(
      `❌ Guard could not delete message ${message.id}:`,
      error
    );
    return false;
  }
}

async function applyTimeout(
  message: Message,
  durationMs: number,
  reason: string
): Promise<boolean> {
  const member = message.member;
  if (!member?.moderatable) {
    console.warn(
      `⚠️ Guard cannot timeout ${message.author.tag}; member is not moderatable.`
    );
    return false;
  }

  try {
    await member.timeout(durationMs, reason);
    return true;
  } catch (error) {
    console.error(
      `❌ Guard could not timeout ${message.author.tag}:`,
      error
    );
    return false;
  }
}

export async function handleModerationMessage(message: Message): Promise<void> {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (!message.content.trim()) return;

  const member = message.member;
  if (member) {
    const supportRoleId = process.env.SUPPORT_ROLE_ID;
    const isStaff =
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      Boolean(supportRoleId && member.roles.cache.has(supportRoleId));

    if (isStaff) return;
  }

  if (await isModerationWhitelisted(message.guild.id, message.author.id)) {
    return;
  }

  const detection = detectMessageContent(message.content);
  if (!detection) return;

  // Escalation is based on the member's existing warning history.
  const previousState = await getModerationUserState(
    message.guild.id,
    message.author.id
  );
  const nextWarningCount = (previousState?.warningCount ?? 0) + 1;

  const deleted = await deleteMessage(message);
  let action = deleted ? "message deleted" : "delete failed";

  let timeoutDurationMs = 0;
  let timeoutLabel = "";

  if (detection.severity === "critical") {
    action = deleted
      ? "message deleted + critical staff alert"
      : "delete failed + critical staff alert";
  } else if (nextWarningCount === 1) {
    action = deleted ? "message deleted + warning" : "delete failed + warning";
  } else if (nextWarningCount === 2) {
    timeoutDurationMs = 10 * 60 * 1000;
    timeoutLabel = "10 minutes";
    action = deleted
      ? "message deleted + 10 minute timeout"
      : "delete failed + 10 minute timeout";
  } else {
    timeoutDurationMs = 60 * 60 * 1000;
    timeoutLabel = "1 hour";
    action = deleted
      ? "message deleted + 1 hour timeout"
      : "delete failed + 1 hour timeout";
  }

  if (timeoutDurationMs > 0) {
    const timedOut = await applyTimeout(
      message,
      timeoutDurationMs,
      `MysticServers Guard: ${detection.rule}`
    );

    if (!timedOut) {
      action += " (timeout failed)";
    }
  }

  const state = await recordModerationEvent({
    guildId: message.guild.id,
    userId: message.author.id,
    channelId: message.channelId,
    messageId: message.id,
    detection,
    messageSnapshot: message.content,
    action,
    warningIssued: true,
  });

  await logModerationEvent(
    message,
    detection,
    action,
    state.violationCount,
    state.warningCount
  );

  if (state.warningCount >= 1) {
    let dm =
      `⚠️ Your message in **${message.guild.name}** was removed by MysticServers Guard.\n\n` +
      `**Reason:** ${detection.reason}\n` +
      `**Rule:** ${detection.rule}\n\n` +
      `Your moderation history: **${state.warningCount} warning(s)** / **${state.violationCount} violation(s)**.`;

    if (timeoutDurationMs > 0) {
      dm += `\n\n🔇 You have been timed out for **${timeoutLabel}** due to repeated violations.`;
    }

    if (detection.severity === "critical") {
      dm += "\n\n🚨 This was classified as a critical violation and has been escalated to the staff team.";
    }

    await message.author.send(dm).catch(() => {});
  }

  console.log(
    `🛡️ Moderation: ${message.author.tag} → ${detection.rule} → ${action}`
  );
}
