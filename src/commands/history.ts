import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const historyCommand =
  new SlashCommandBuilder()
    .setName("history")
    .setDescription(
      "View a customer's MysticServers ticket history"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The Discord customer to look up")
        .setRequired(true)
    );
