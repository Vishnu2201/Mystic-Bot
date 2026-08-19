import { Message } from "discord.js";
import { handleModerationMessage } from "../services/moderationService";

export async function handleMessageCreate(message: Message): Promise<void> {
  try {
    await handleModerationMessage(message);
  } catch (error) {
    console.error("❌ MysticServers Guard error:", error);
  }
}
