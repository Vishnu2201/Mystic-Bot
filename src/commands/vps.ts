import { SlashCommandBuilder } from "discord.js";

export const vpsCommand = new SlashCommandBuilder()
  .setName("vps")
  .setDescription("View and manage your VPS instances")
  .addSubcommand((subcommand) => subcommand.setName("status").setDescription("View your VPS instances"))
  .addSubcommand((subcommand) => subcommand.setName("info").setDescription("View detailed VPS information").addIntegerOption((option) => option.setName("number").setDescription("Your VPS number").setMinValue(1)))
  .addSubcommand((subcommand) => subcommand.setName("terminal").setDescription("Open a private VPS terminal session").addIntegerOption((option) => option.setName("number").setDescription("Your VPS number when you have multiple").setMinValue(1)))
  .addSubcommand((subcommand) => subcommand.setName("terminal-diagnose").setDescription("Diagnose a VPS terminal relay").addIntegerOption((option) => option.setName("number").setDescription("VPS number").setRequired(true).setMinValue(1)))
  .addSubcommand((subcommand) =>
    subcommand
      .setName("dashboard")
      .setDescription("Refresh the staff VPS management dashboard")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("renew")
      .setDescription("Record a VPS renewal")
      .addIntegerOption((option) =>
        option
          .setName("number")
          .setDescription("VPS number")
          .setRequired(true)
          .setMinValue(1)
      )
      .addIntegerOption((option) =>
        option
          .setName("months")
          .setDescription("Renewal period")
          .setRequired(true)
          .addChoices(
            { name: "1 Month", value: 1 },
            { name: "3 Months", value: 3 },
            { name: "6 Months", value: 6 },
            { name: "12 Months", value: 12 }
          )
      )
  );
