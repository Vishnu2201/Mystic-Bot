import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { MINECRAFT_PLANS } from "../config/minecraftPlans";

export const minecraftCreateCommand = new SlashCommandBuilder()
  .setName("minecraft-create")
  .setDescription("Provision a Minecraft server for a customer (Staff only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption((option) =>
    option.setName("user").setDescription("The customer to provision for").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("plan")
      .setDescription("Minecraft hosting plan")
      .setRequired(true)
      .addChoices(
        ...MINECRAFT_PLANS.map((plan) => ({
          name: `${plan.name} — ${plan.ramGb}GB / ${plan.cpuPercent}% CPU / ${plan.storageGb}GB`,
          value: plan.id,
        }))
      )
  )
  .addIntegerOption((option) =>
    option
      .setName("billing_months")
      .setDescription("Billing cycle")
      .addChoices(
        { name: "1 Month", value: 1 },
        { name: "3 Months", value: 3 },
        { name: "6 Months", value: 6 },
        { name: "12 Months", value: 12 }
      )
  );
