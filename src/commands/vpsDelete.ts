import { SlashCommandBuilder } from "discord.js";

export const vpsDeleteCommand = new SlashCommandBuilder()
  .setName("vps-delete")
  .setDescription("Permanently delete/decommission a VPS (Staff only)")
  .addIntegerOption((option) =>
    option
      .setName("number")
      .setDescription("The VPS number to delete (e.g. 8)")
      .setMinValue(1)
  )
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("Select a customer to view their VPS instances for deletion")
  );
