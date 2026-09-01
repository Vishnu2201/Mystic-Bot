import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const vpsCreateCommand = new SlashCommandBuilder()
  .setName("vps-create")
  .setDescription("Create and provision a custom VPS for a customer")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((option) => option.setName("user").setDescription("VPS customer").setRequired(true))
  .addIntegerOption((option) => option.setName("vcpu").setDescription("vCPU cores").setRequired(true).setMinValue(1).setMaxValue(64))
  .addIntegerOption((option) => option.setName("ram").setDescription("RAM in GB").setRequired(true).setMinValue(1).setMaxValue(512))
  .addIntegerOption((option) => option.setName("disk").setDescription("Disk in GB").setRequired(true).setMinValue(1).setMaxValue(4096))
  .addStringOption((option) => option.setName("location").setDescription("Provisioning location").setMaxLength(50))
  .addStringOption((option) => option.setName("hostname").setDescription("Optional hostname").setMaxLength(63))
  .addStringOption((option) => option.setName("plan_name").setDescription("Optional plan name").setMaxLength(100))
  .addIntegerOption((option) => option.setName("billing_months").setDescription("Billing cycle").addChoices({ name: "1 Month", value: 1 }, { name: "3 Months", value: 3 }, { name: "6 Months", value: 6 }, { name: "12 Months", value: 12 }));
