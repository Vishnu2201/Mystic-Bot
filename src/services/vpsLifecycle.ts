import { Client, EmbedBuilder, TextChannel } from "discord.js";

import {
  claimExpiryNotification,
  listVpsInstances,
  markExpiredVps,
  type VpsInstanceRecord,
} from "./vpsDatabase";

import { getCustomerById } from "./ticketDatabase";

const WARNING_DAYS = [7, 3, 1] as const;

function managementChannelNameMatches(name: string): boolean {
  return name.toLowerCase().endsWith("vps-management");
}

export function getVpsManagementChannel(
  client: Client
): TextChannel | null {
  const configuredId = process.env.VPS_MANAGEMENT_CHANNEL_ID;

  if (configuredId) {
    for (const guild of client.guilds.cache.values()) {
      const channel = guild.channels.cache.get(configuredId);

      if (channel instanceof TextChannel) {
        return channel;
      }
    }
  }

  for (const guild of client.guilds.cache.values()) {
    const channel = guild.channels.cache.find(
      (item) =>
        item instanceof TextChannel &&
        managementChannelNameMatches(item.name)
    );

    if (channel instanceof TextChannel) {
      return channel;
    }
  }

  return null;
}

function daysUntil(expiry: Date): number {
  const now = Date.now();
  const expiryTime = new Date(expiry).getTime();

  return Math.ceil(
    (expiryTime - now) / 86400000
  );
}

function statusFor(vps: VpsInstanceRecord): string {
  if (vps.status === "suspended") {
    return "⚫ Suspended";
  }

  if (vps.status === "terminated") {
    return "🗑️ Terminated";
  }

  const days = daysUntil(vps.expiresAt);

  if (days < 0 || vps.status === "expired") {
    return "🔴 Expired";
  }

  if (days <= 7) {
    return "🟡 Expiring Soon";
  }

  return "🟢 Active";
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(date));
}

function formatCycle(months: number): string {
  if (months === 1) {
    return "Monthly";
  }

  return `${months} Months`;
}

export async function refreshVpsManagementDashboard(
  client: Client
): Promise<void> {
  const channel = getVpsManagementChannel(client);

  if (!channel) {
    console.warn(
      "⚠️ VPS management channel not found. Create #vps-management or set VPS_MANAGEMENT_CHANNEL_ID."
    );
    return;
  }

  const vpsList = await listVpsInstances();

  const active = vpsList.filter(
    (vps) => statusFor(vps) === "🟢 Active"
  );

  const expiring = vpsList.filter(
    (vps) => statusFor(vps) === "🟡 Expiring Soon"
  );

  const expired = vpsList.filter(
    (vps) => statusFor(vps) === "🔴 Expired"
  );

  const suspended = vpsList.filter(
    (vps) => statusFor(vps) === "⚫ Suspended"
  );

  const lines: string[] = [];

  const customerCache = new Map<
    string,
    string
  >();

  const addSection = async (
    title: string,
    items: VpsInstanceRecord[],
    emptyMessage: string
  ): Promise<void> => {
    lines.push(`**${title}**`);

    if (items.length === 0) {
      lines.push(emptyMessage);
      lines.push("");
      return;
    }

    for (const vps of items.slice(0, 15)) {
      const days = daysUntil(vps.expiresAt);

      let customerLabel =
        `Customer ${vps.customerId}`;

      if (!customerCache.has(vps.customerId)) {
        const customer =
          await getCustomerById(vps.customerId);

        customerLabel = customer
          ? `<@${customer.discordUserId}>`
          : customerLabel;

        customerCache.set(
          vps.customerId,
          customerLabel
        );
      } else {
        customerLabel =
          customerCache.get(vps.customerId)!;
      }

      const remaining =
        days < 0
          ? `${Math.abs(days)} day(s) overdue`
          : `${days} day(s) left`;

      lines.push(
        `🖥️ **#${String(vps.vpsNumber).padStart(
          6,
          "0"
        )}** • ${vps.planName} • ${vps.location}`
      );

      lines.push(
        `   👤 ${customerLabel} • ${formatCycle(
          vps.billingCycleMonths
        )} • Expires **${formatDate(
          vps.expiresAt
        )}** • ${remaining}`
      );

      lines.push("");
    }

    if (items.length > 15) {
      lines.push(
        `…and ${items.length - 15} more.`
      );

      lines.push("");
    }
  };

  lines.push(
    `🟢 **Active:** ${active.length}   •   ` +
      `🟡 **Expiring:** ${expiring.length}   •   ` +
      `🔴 **Expired:** ${expired.length}   •   ` +
      `⚫ **Suspended:** ${suspended.length}`
  );

  lines.push("");

  await addSection(
    "🟡 EXPIRING SOON",
    expiring,
    "Nothing expiring within 7 days."
  );

  await addSection(
    "🔴 EXPIRED",
    expired,
    "No expired VPSs."
  );

  await addSection(
    "🟢 ACTIVE",
    active,
    "No active VPSs."
  );

  await addSection(
    "⚫ SUSPENDED",
    suspended,
    "No suspended VPSs."
  );

  const embed = new EmbedBuilder()
    .setColor(
      expired.length > 0
        ? 0xed4245
        : expiring.length > 0
          ? 0xfee75c
          : 0x57f287
    )
    .setTitle(
      "🖥️ MysticServers VPS Management"
    )
    .setDescription(
      lines.join("\n")
    )
    .setFooter({
      text: "Staff only • VPS lifecycle dashboard",
    })
    .setTimestamp();

  const recent = await channel.messages
    .fetch({ limit: 50 })
    .catch(() => null);

  const existing = recent?.find(
    (message) =>
      message.author.id === client.user?.id &&
      message.embeds[0]?.title ===
        "🖥️ MysticServers VPS Management"
  );

  if (existing) {
    await existing.edit({
      embeds: [embed],
    });
  } else {
    await channel.send({
      embeds: [embed],
    });
  }
}

async function sendExpiryNotification(
  client: Client,
  vps: VpsInstanceRecord
): Promise<void> {
  const customer =
    await getCustomerById(vps.customerId);

  if (!customer) {
    return;
  }

  const days =
    daysUntil(vps.expiresAt);

  let noticeType: string;
  let title: string;
  let description: string;

  if (days < 0) {
    noticeType = "expired";

    title =
      "🔴 Your MysticServers VPS Has Expired";

    description =
      `Your VPS **#${String(
        vps.vpsNumber
      ).padStart(
        6,
        "0"
      )}** expired on **${formatDate(
        vps.expiresAt
      )}**.\n\n` +
      "Please contact MysticServers Support if you would like to renew it.";
  } else if (
    WARNING_DAYS.includes(
      days as 1 | 3 | 7
    )
  ) {
    noticeType = `${days}_days`;

    title =
      `⚠️ Your MysticServers VPS Expires in ${days} ` +
      `Day${days === 1 ? "" : "s"}`;

    description =
      `Your VPS **#${String(
        vps.vpsNumber
      ).padStart(
        6,
        "0"
      )}** is approaching its expiry date.\n\n` +
      `**Expiry:** ${formatDate(
        vps.expiresAt
      )}\n` +
      `**Plan:** ${vps.planName}\n` +
      `**Location:** ${vps.location}\n\n` +
      "Please contact MysticServers Support to renew your VPS.";
  } else {
    return;
  }

  const claimed =
    await claimExpiryNotification(
      vps.id,
      vps.expiresAt,
      noticeType
    );

  if (!claimed) {
    return;
  }

  try {
    const user =
      await client.users.fetch(
        customer.discordUserId
      );

    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(
            days < 0
              ? 0xed4245
              : 0xfee75c
          )
          .setTitle(title)
          .setDescription(description)
          .setFooter({
            text: "MysticServers • VPS Billing",
          })
          .setTimestamp(),
      ],
    });
  } catch (error) {
    console.error(
      `❌ Failed to DM expiry notice for VPS #${vps.vpsNumber}:`,
      error
    );
  }
}

export async function runVpsLifecycleCheck(
  client: Client
): Promise<void> {
  try {
    const expiredCount =
      await markExpiredVps();

    if (expiredCount > 0) {
      console.log(
        `🕒 Marked ${expiredCount} VPS instance(s) as expired.`
      );
    }

    const vpsList =
      await listVpsInstances();

    for (const vps of vpsList) {
      await sendExpiryNotification(
        client,
        vps
      );
    }

    await refreshVpsManagementDashboard(
      client
    );

    console.log(
      `✅ VPS lifecycle check completed. Checked ${vpsList.length} VPS instance(s).`
    );
  } catch (error) {
    console.error(
      "❌ VPS lifecycle check failed:",
      error
    );
  }
}