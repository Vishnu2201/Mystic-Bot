import "dotenv/config";

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";

import { handleGuildMemberAdd } from "./events/guildMemberAdd";
import { handleMessageCreate } from "./events/messageCreate";
import { handleInteraction } from "./events/interactionCreate";
import { runVpsLifecycleCheck } from "./services/vpsLifecycle";
import { startPublicSshGatewayReconciler } from "./services/publicSshGatewayReconciler";

import { ticketCommand } from "./commands/ticket";
import { pricingCommand } from "./commands/pricing";
import { vpsCommand } from "./commands/vps";
import { vpsCreateCommand } from "./commands/vpsCreate";
import { modCommand } from "./commands/mod";
import { minecraftCommand } from "./commands/minecraft";
import { minecraftCreateCommand } from "./commands/minecraftCreate";
import { vpsDeleteCommand } from "./commands/vpsDelete";

function requireEnv(
  name: string
): string {
  const value =
    process.env[name];

  if (!value) {
    throw new Error(
      `${name} is missing from .env`
    );
  }

  return value;
}

const token =
  requireEnv("DISCORD_TOKEN");

const clientId =
  requireEnv("CLIENT_ID");

const guildId =
  requireEnv("GUILD_ID");

const client =
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

async function registerCommands(): Promise<void> {
  const rest =
    new REST({
      version: "10",
    }).setToken(token);

  await rest.put(
    Routes.applicationGuildCommands(
      clientId,
      guildId
    ),
    {
      body: [
        ticketCommand.toJSON(),
        pricingCommand.toJSON(),
        vpsCommand.toJSON(),
        vpsCreateCommand.toJSON(),
        vpsDeleteCommand.toJSON(),
        modCommand.toJSON(),
        minecraftCommand.toJSON(),
        minecraftCreateCommand.toJSON(),
      ],
    }
  );

  console.log(
    "✅ Slash commands registered."
  );
}

client.once(
  "ready",
  async (readyClient) => {
    console.log(
      `✅ ${readyClient.user.tag} is online!`
    );

    console.log(
      `Connected to ${readyClient.guilds.cache.size} server(s).`
    );

    try {
      await registerCommands();
    } catch (error) {
      console.error(
        "❌ Failed to register slash commands:",
        error
      );
    }

    // Start Public SSH Gateway reconciler service
    startPublicSshGatewayReconciler();

    // Run VPS expiry/renewal lifecycle checks once at startup.
    await runVpsLifecycleCheck(client);
    setInterval(() => {
      void runVpsLifecycleCheck(client);
    }, 60 * 60 * 1000);
  }
);

client.on(
  "guildMemberAdd",
  async (member) => {
    await handleGuildMemberAdd(
      member
    );
  }
);

client.on(
  "messageCreate",
  async (message) => {
    await handleMessageCreate(message);
  }
);

client.on(
  "interactionCreate",
  async (interaction) => {
    await handleInteraction(
      interaction
    );
  }
);

client.on(
  "error",
  (error) => {
    console.error(
      "Discord client error:",
      error
    );
  }
);

client.login(token);
