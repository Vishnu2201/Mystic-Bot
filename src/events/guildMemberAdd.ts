import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  TextChannel,
} from "discord.js";

import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";

// ============================================================
// Helpers
// ============================================================

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Keep usernames from overflowing the design.
function formatDisplayName(
  name: string,
  maxLength = 18
): string {
  if (name.length <= maxLength) {
    return name;
  }

  return (
    name.substring(0, maxLength - 1) +
    "…"
  );
}

// ============================================================
// Generate Dynamic Welcome Image
// ============================================================

async function generateWelcomeImage(
  member: GuildMember
): Promise<Buffer> {
  const backgroundPath =
    path.join(
      process.cwd(),
      "assets",
      "welcome-background.png"
    );

  if (!fs.existsSync(backgroundPath)) {
    throw new Error(
      `Welcome background not found: ${backgroundPath}`
    );
  }

  // ----------------------------------------------------------
  // Get Discord avatar
  // ----------------------------------------------------------

  const avatarUrl =
    member.user.displayAvatarURL({
      extension: "png",
      size: 256,
      forceStatic: true,
    });

  const avatarResponse =
    await fetch(avatarUrl);

  if (!avatarResponse.ok) {
    throw new Error(
      `Failed to download Discord avatar: ${avatarResponse.status}`
    );
  }

  const avatarArrayBuffer =
    await avatarResponse.arrayBuffer();

  const avatarBuffer =
    await sharp(
      Buffer.from(avatarArrayBuffer)
    )
      .resize(180, 180, {
        fit: "cover",
      })
      .png()
      .toBuffer();

  const avatarBase64 =
    avatarBuffer.toString(
      "base64"
    );

  // ----------------------------------------------------------
  // Member information
  // ----------------------------------------------------------

  const displayName =
    formatDisplayName(
      member.displayName
    );

  const memberNumber =
    member.guild.memberCount;

  const safeName =
    escapeXml(displayName);

  // ----------------------------------------------------------
  // Dynamic SVG layer
  // ----------------------------------------------------------

  const dynamicSvg = `
  <svg
    width="1295"
    height="815"
    viewBox="0 0 1295 815"
    xmlns="http://www.w3.org/2000/svg"
  >

    <defs>

      <!-- Avatar circle -->
      <clipPath id="avatarClip">
        <circle
          cx="155"
          cy="330"
          r="90"
        />
      </clipPath>

      <!-- Avatar glow -->
      <filter
        id="glow"
        x="-100%"
        y="-100%"
        width="300%"
        height="300%"
      >
        <feGaussianBlur
          stdDeviation="8"
          result="blur"
        />

        <feMerge>
          <feMergeNode
            in="blur"
          />

          <feMergeNode
            in="SourceGraphic"
          />
        </feMerge>
      </filter>

      <!-- Gradient ring -->
      <linearGradient
        id="avatarRing"
        x1="0%"
        y1="0%"
        x2="100%"
        y2="100%"
      >
        <stop
          offset="0%"
          stop-color="#22D3EE"
        />

        <stop
          offset="50%"
          stop-color="#6366F1"
        />

        <stop
          offset="100%"
          stop-color="#A855F7"
        />
      </linearGradient>

      <!-- Name gradient -->
      <linearGradient
        id="nameGradient"
        x1="0%"
        y1="0%"
        x2="100%"
        y2="0%"
      >
        <stop
          offset="0%"
          stop-color="#FFFFFF"
        />

        <stop
          offset="100%"
          stop-color="#22D3EE"
        />
      </linearGradient>

    </defs>

    <!-- ================================================== -->
    <!-- Avatar -->
    <!-- ================================================== -->

    <circle
      cx="155"
      cy="330"
      r="98"
      fill="none"
      stroke="url(#avatarRing)"
      stroke-width="8"
      filter="url(#glow)"
    />

    <circle
      cx="155"
      cy="330"
      r="90"
      fill="#050B1B"
    />

    <image
      href="data:image/png;base64,${avatarBase64}"
      x="65"
      y="240"
      width="180"
      height="180"
      preserveAspectRatio="xMidYMid slice"
      clip-path="url(#avatarClip)"
    />

    <!-- ================================================== -->
    <!-- Welcome text -->
    <!-- ================================================== -->

    <text
      x="300"
      y="305"
      font-family="Arial, Helvetica, sans-serif"
      font-size="40"
      font-weight="700"
      fill="#FFFFFF"
    >
      Welcome
    </text>

    <text
      x="300"
      y="305"
      dx="190"
      font-family="Arial, Helvetica, sans-serif"
      font-size="40"
      font-weight="700"
      fill="url(#nameGradient)"
    >
      ${safeName}
    </text>

    <!-- ================================================== -->
    <!-- Member number -->
    <!-- ================================================== -->

    <rect
      x="298"
      y="340"
      width="310"
      height="58"
      rx="29"
      fill="#070D24"
      stroke="#6D4AFF"
      stroke-opacity="0.65"
      stroke-width="2"
    />

    <text
      x="328"
      y="378"
      font-family="Arial, Helvetica, sans-serif"
      font-size="24"
      font-weight="500"
      fill="#D8DCEF"
    >
      You are member
    </text>

    <text
      x="548"
      y="378"
      font-family="Arial, Helvetica, sans-serif"
      font-size="25"
      font-weight="700"
      fill="#7C6CFF"
    >
      #${memberNumber}
    </text>

  </svg>
  `;

  // ----------------------------------------------------------
  // Composite dynamic layer onto background
  // ----------------------------------------------------------

  return await sharp(
    backgroundPath
  )
    .composite([
      {
        input: Buffer.from(
          dynamicSvg
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

// ============================================================
// Welcome Handler
// ============================================================

export async function handleGuildMemberAdd(
  member: GuildMember
): Promise<void> {
  try {
    // ========================================================
    // Environment variables
    // ========================================================

    const welcomeChannelId =
      process.env.WELCOME_CHANNEL_ID;

    const memberRoleId =
      process.env.MEMBER_ROLE_ID;

    const ticketPanelChannelId =
      process.env.TICKET_PANEL_CHANNEL_ID;

    const pricingChannelId =
      process.env.PRICING_CHANNEL_ID;

    // ========================================================
    // Validate configuration
    // ========================================================

    if (!welcomeChannelId) {
      console.error(
        "❌ WELCOME_CHANNEL_ID is missing from .env"
      );
      return;
    }

    if (!memberRoleId) {
      console.error(
        "❌ MEMBER_ROLE_ID is missing from .env"
      );
      return;
    }

    if (!ticketPanelChannelId) {
      console.error(
        "❌ TICKET_PANEL_CHANNEL_ID is missing from .env"
      );
      return;
    }

    if (!pricingChannelId) {
      console.error(
        "❌ PRICING_CHANNEL_ID is missing from .env"
      );
      return;
    }

    // ========================================================
    // Assign Member Role
    // ========================================================

    const memberRole =
      member.guild.roles.cache.get(
        memberRoleId
      );

    if (!memberRole) {
      console.error(
        `❌ Member role ${memberRoleId} was not found.`
      );
    } else {
      try {
        await member.roles.add(
          memberRole,
          "MysticServers new member"
        );

        console.log(
          `👤 Member role assigned to ${member.user.tag}`
        );
      } catch (error) {
        console.error(
          `❌ Failed to assign Member role to ${member.user.tag}:`,
          error
        );
      }
    }

    // ========================================================
    // Get Welcome Channel
    // ========================================================

    const channel =
      await member.guild.channels.fetch(
        welcomeChannelId
      );

    if (
      !channel ||
      channel.type !== 0
    ) {
      console.error(
        "❌ Welcome channel is invalid or is not a text channel."
      );

      return;
    }

    const welcomeChannel =
      channel as TextChannel;

    // ========================================================
    // Generate Dynamic Image
    // ========================================================

    console.log(
      `🖼️ Generating welcome image for ${member.user.tag}...`
    );

    const welcomeImage =
      await generateWelcomeImage(
        member
      );

    // ========================================================
    // Discord Channel URLs
    // ========================================================

    const ticketChannelUrl =
      `https://discord.com/channels/${member.guild.id}/${ticketPanelChannelId}`;

    const pricingChannelUrl =
      `https://discord.com/channels/${member.guild.id}/${pricingChannelId}`;

    // ========================================================
    // Real Discord Buttons
    // ========================================================

    const buttons =
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(

          new ButtonBuilder()
            .setLabel(
              "Create Ticket"
            )
            .setEmoji("🎫")
            .setStyle(
              ButtonStyle.Link
            )
            .setURL(
              ticketChannelUrl
            ),

          new ButtonBuilder()
            .setLabel(
              "Pricing"
            )
            .setEmoji("💰")
            .setStyle(
              ButtonStyle.Link
            )
            .setURL(
              pricingChannelUrl
            )
        );

    // ========================================================
    // Attachment
    // ========================================================

    const attachment =
      new AttachmentBuilder(
        welcomeImage,
        {
          name:
            "mysticservers-welcome.png",
        }
      );

    // ========================================================
    // Send Welcome Message
    // ========================================================

    await welcomeChannel.send({
      files: [
        attachment,
      ],

      components: [
        buttons,
      ],
    });

    // ========================================================
    // Log
    // ========================================================

    console.log(
      `👋 Dynamic welcome sent to ${member.user.tag} (#${member.guild.memberCount})`
    );

  } catch (error) {
    console.error(
      "❌ Welcome system error:",
      error
    );
  }
}