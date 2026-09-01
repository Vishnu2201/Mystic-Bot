import { getMinecraftPlanById, MinecraftPlan } from "../config/minecraftPlans";
import { PterodactylProvider, PterodactylUser, PterodactylServer, PterodactylAllocation } from "../providers/pterodactylProvider";
import { generateSecureInitialPassword } from "./vpsProvisioningService";
import { generateMinecraftPterodactylUsername, allocateAndBuildMinecraftServerName } from "./minecraftNamingService";
import {
  createMinecraftServer,
  deleteMinecraftServerForRollback,
  getCustomerPterodactylUserId,
  updateCustomerPterodactylUserId,
  MinecraftServerRecord,
} from "./minecraftDatabase";

export interface ProvisionMinecraftServerRequest {
  customerId: string;
  discordUserId: string;
  discordUsername: string;
  discordDisplayName: string;
  planId: string;
  billingCycleMonths?: number;
  provisionedByDiscordId: string;
  ticketId?: string;
  customerHostname?: string;
}

export interface ProvisionMinecraftServerResult {
  serverRecord: MinecraftServerRecord;
  pterodactylServer: PterodactylServer;
  pterodactylUser: PterodactylUser;
  connectionAddress: string;
  initialPassword?: string;
  isNewUser: boolean;
  plan: MinecraftPlan;
}

export async function provisionMinecraftServer(
  request: ProvisionMinecraftServerRequest
): Promise<ProvisionMinecraftServerResult> {
  const pteroProvider = new PterodactylProvider();

  // 1. Fetch & validate plan
  const plan = getMinecraftPlanById(request.planId);
  if (!plan) {
    throw new Error(`Invalid Minecraft hosting plan: "${request.planId}".`);
  }

  const billingCycleMonths = request.billingCycleMonths ?? 1;

  // 2. Allocate sequence & build server name
  const { serverName, sequence } = await allocateAndBuildMinecraftServerName(
    request.customerId,
    request.discordDisplayName || request.discordUsername
  );

  console.log(`[Minecraft Provisioning] Starting provisioning for ${request.discordUsername} (${request.discordUserId}) - Server: "${serverName}" - Plan: ${plan.name}`);

  // 3. User account resolution / creation (Authoritative Discord User ID identity)
  let pteroUser: PterodactylUser | null = null;
  let initialPassword: string | undefined = undefined;
  let isNewUser = false;

  const existingPteroUserId = await getCustomerPterodactylUserId(request.customerId);
  const pteroEmail = `${request.discordUserId}@mysticservers.com`;
  let targetUsername = generateMinecraftPterodactylUsername(
    request.discordUsername,
    request.discordUserId
  );

  // First, check by stored database Pterodactyl User ID if available
  if (existingPteroUserId) {
    try {
      pteroUser = await pteroProvider.getUser(existingPteroUserId);
    } catch {
      /* fallback to email search */
    }
  }

  // Second, search by authoritative customer email
  if (!pteroUser) {
    try {
      pteroUser = await pteroProvider.findUserByEmail(pteroEmail);
    } catch {
      /* search failed */
    }
  }

  // Check username collision on Pterodactyl panel
  if (!pteroUser) {
    try {
      const existingByUsername = await pteroProvider.findUserByUsername(targetUsername);
      if (existingByUsername) {
        if (existingByUsername.email.toLowerCase() === pteroEmail.toLowerCase()) {
          pteroUser = existingByUsername;
        } else {
          // Username taken by a different customer account. Use deterministic variation for this user.
          const shortId = request.discordUserId.slice(-4);
          targetUsername = `${targetUsername.slice(0, 25)}_${shortId}`;
        }
      }
    } catch {
      /* ignore lookup error */
    }
  }

  if (!pteroUser) {
    // Create new Pterodactyl user account for this customer
    initialPassword = generateSecureInitialPassword(20);
    isNewUser = true;

    console.log(`[Minecraft Provisioning] Creating new Pterodactyl user for ${request.discordUsername} (email: ${pteroEmail}, username: ${targetUsername})`);

    pteroUser = await pteroProvider.createUser({
      username: targetUsername,
      email: pteroEmail,
      firstName: request.discordDisplayName || request.discordUsername,
      lastName: `(${request.discordUserId})`,
      password: initialPassword,
    });

    await updateCustomerPterodactylUserId(request.customerId, pteroUser.id);
  } else {
    console.log(`[Minecraft Provisioning] Reusing existing Pterodactyl user #${pteroUser.id} (${pteroUser.username})`);
    if (!existingPteroUserId || existingPteroUserId !== pteroUser.id) {
      await updateCustomerPterodactylUserId(request.customerId, pteroUser.id);
    }
  }

  // 4. Find available allocation
  const allocation: PterodactylAllocation = await pteroProvider.findAvailableAllocation();
  console.log(`[Minecraft Provisioning] Selected allocation #${allocation.id} (${allocation.ip}:${allocation.port})`);

  // 5. Create Pterodactyl Server
  let pteroServer: PterodactylServer;
  try {
    pteroServer = await pteroProvider.createServer({
      name: serverName,
      userId: pteroUser.id,
      ramMb: plan.ramMb,
      cpuLimit: plan.cpuPercent,
      storageMb: plan.storageMb,
      allocationId: allocation.id,
    });
    console.log(`[Minecraft Provisioning] Created Pterodactyl server #${pteroServer.id} (identifier: ${pteroServer.identifier})`);
  } catch (error) {
    console.error(`[Minecraft Provisioning] Pterodactyl server creation failed for ${serverName}:`, error);
    throw error;
  }

  // 6. Save to Database with rollback safeguard
  let serverRecord: MinecraftServerRecord;
  const customerHostname = request.customerHostname || process.env.MINECRAFT_HOSTNAME?.trim() || "minecraft.mysticservers.com";

  try {
    serverRecord = await createMinecraftServer({
      customerId: request.customerId,
      ticketId: request.ticketId,
      pterodactylServerId: pteroServer.id,
      pterodactylIdentifier: pteroServer.identifier,
      pterodactylUserId: pteroUser.id,
      serverName,
      customerMinecraftSequence: sequence,
      planId: plan.id,
      planName: plan.name,
      priceInr: plan.priceInr,
      priceUsd: plan.priceUsd,
      ramMb: plan.ramMb,
      cpuLimit: plan.cpuPercent,
      storageMb: plan.storageMb,
      allocationId: allocation.id,
      allocationIp: allocation.ip,
      allocationPort: allocation.port,
      customerHostname,
      provisionedByDiscordId: request.provisionedByDiscordId,
      billingCycleMonths,
    });
  } catch (dbError: any) {
    console.error(`[Minecraft Provisioning] Database insertion failed after server creation. Rolling back Pterodactyl server #${pteroServer.id}...`, dbError);
    try {
      await pteroProvider.deleteServer(pteroServer.id, true);
    } catch (cleanupError) {
      console.error(`[Minecraft Provisioning] Rollback deletion of Pterodactyl server #${pteroServer.id} failed:`, cleanupError);
    }

    if (dbError.code === "23505" && dbError.constraint?.includes("ticket_id")) {
      throw new Error("A Minecraft server has already been provisioned for this ticket.");
    }
    throw dbError;
  }

  const connectionAddress = `${customerHostname}:${allocation.port}`;
  console.log(`[Minecraft Provisioning] Provisioning complete. Server #${serverRecord.serverNumber} (${serverName}) connected at ${connectionAddress}`);

  return {
    serverRecord,
    pterodactylServer: pteroServer,
    pterodactylUser: pteroUser,
    connectionAddress,
    initialPassword,
    isNewUser,
    plan,
  };
}
