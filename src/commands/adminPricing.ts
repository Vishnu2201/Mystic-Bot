import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const adminPricingCommand = new SlashCommandBuilder()
  .setName("admin-pricing")
  .setDescription("Manage MysticServers pricing catalog and billing options (Admin only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
