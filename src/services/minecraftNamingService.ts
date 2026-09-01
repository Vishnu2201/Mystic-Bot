import { allocateCustomerMinecraftSequence } from "./minecraftDatabase";

/**
 * Sanitizes a customer's Discord username into a valid Pterodactyl panel username.
 * Pterodactyl username rules: Alphanumeric characters, underscores, and hyphens. 3 to 32 chars.
 */
export function generateMinecraftPterodactylUsername(
  discordUsername?: string | null,
  discordUserId?: string | null
): string {
  let sanitized = (discordUsername ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .trim();

  if (sanitized.length < 3) {
    const safeUserId = (discordUserId ?? "").replace(/[^a-zA-Z0-9]/g, "");
    sanitized = safeUserId ? `user_${safeUserId}` : "mc_user";
  }

  if (sanitized.length > 30) {
    sanitized = sanitized.slice(0, 30);
  }

  return sanitized;
}

/**
 * Formats a Discord user's display name or username and sequence number into a server name.
 * Example: "MysticBlues2201" + 1 -> "MysticBlues2201 - 01"
 */
export function generateMinecraftServerName(
  discordDisplayName: string | undefined | null,
  sequence: number
): string {
  const name = (discordDisplayName ?? "Customer")
    .replace(/[\r\n\t]+/g, " ")
    .trim();

  const paddedSeq = String(sequence).padStart(2, "0");
  return `${name} - ${paddedSeq}`;
}

/**
 * Atomically allocates the next per-customer sequence for Minecraft hosting
 * and builds the server name.
 */
export async function allocateAndBuildMinecraftServerName(
  customerId: string,
  discordDisplayName: string | undefined | null
): Promise<{ serverName: string; sequence: number }> {
  const sequence = await allocateCustomerMinecraftSequence(customerId);
  const serverName = generateMinecraftServerName(discordDisplayName, sequence);
  return { serverName, sequence };
}
