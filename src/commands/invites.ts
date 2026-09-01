import { SlashCommandBuilder } from "discord.js";

export const invitesCommand = new SlashCommandBuilder()
  .setName("invites")
  .setDescription("MysticServers Referral & Free VPS Reward System")
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("View your current referral statistics and reward progress")
  )
  .addSubcommand((sub) =>
    sub
      .setName("claim")
      .setDescription("Claim an available free VPS reward")
  )
  .addSubcommand((sub) =>
    sub
      .setName("leaderboard")
      .setDescription("View the top inviters by qualifying VPS referrals")
  )
  .addSubcommand((sub) =>
    sub
      .setName("admin")
      .setDescription("Staff: View referral diagnostics for a user")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("The user to inspect")
          .setRequired(true)
      )
  );
