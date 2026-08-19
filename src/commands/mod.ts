import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const modCommand = new SlashCommandBuilder()
  .setName("mod")
  .setDescription("MysticServers Guard moderation tools")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("user")
      .setDescription("View a member's moderation profile")
      .addUserOption((option) =>
        option
          .setName("member")
          .setDescription("The member to inspect")
          .setRequired(true)
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("whitelist")
      .setDescription("Manage moderation whitelists")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("add")
          .setDescription("Whitelist a member from automatic moderation")
          .addUserOption((option) =>
            option
              .setName("member")
              .setDescription("The member to whitelist")
              .setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("remove")
          .setDescription("Remove a member from the moderation whitelist")
          .addUserOption((option) =>
            option
              .setName("member")
              .setDescription("The member to remove from the whitelist")
              .setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("list")
          .setDescription("List whitelisted members")
      )
  );
