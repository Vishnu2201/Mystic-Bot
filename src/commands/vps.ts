import { SlashCommandBuilder } from "discord.js";

export const vpsCommand = new SlashCommandBuilder()
  .setName("vps")
  .setDescription("Staff VPS lifecycle management")
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
