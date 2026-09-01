import { pool } from "../config/database";

export interface MinecraftServerRecord {
  id: string;
  serverNumber: number;
  customerId: string;
  ticketId?: string;
  pterodactylServerId: number;
  pterodactylIdentifier: string;
  pterodactylUserId: number;
  serverName: string;
  customerMinecraftSequence: number;
  planId: string;
  planName: string;
  priceInr: number;
  priceUsd: number;
  ramMb: number;
  cpuLimit: number;
  storageMb: number;
  allocationId: number;
  allocationIp: string;
  allocationPort: number;
  customerHostname: string;
  sshUsername: string;
  sshPort: number;
  billingCycleMonths: number;
  provisionedAt?: Date;
  expiresAt: Date;
  renewalCount: number;
  status: string;
  provisionedByDiscordId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateMinecraftServerInput {
  customerId: string;
  ticketId?: string;
  pterodactylServerId: number;
  pterodactylIdentifier: string;
  pterodactylUserId: number;
  serverName: string;
  customerMinecraftSequence: number;
  planId: string;
  planName: string;
  priceInr: number;
  priceUsd: number;
  ramMb: number;
  cpuLimit: number;
  storageMb: number;
  allocationId: number;
  allocationIp: string;
  allocationPort: number;
  customerHostname?: string;
  sshUsername?: string;
  sshPort?: number;
  provisionedByDiscordId: string;
  billingCycleMonths: number;
}

const MINECRAFT_SELECT = `
  minecraft_servers.id,
  minecraft_servers.server_number AS "serverNumber",
  minecraft_servers.customer_id AS "customerId",
  minecraft_servers.ticket_id AS "ticketId",
  minecraft_servers.pterodactyl_server_id AS "pterodactylServerId",
  minecraft_servers.pterodactyl_identifier AS "pterodactylIdentifier",
  minecraft_servers.pterodactyl_user_id AS "pterodactylUserId",
  minecraft_servers.server_name AS "serverName",
  minecraft_servers.customer_minecraft_sequence AS "customerMinecraftSequence",
  minecraft_servers.plan_id AS "planId",
  minecraft_servers.plan_name AS "planName",
  minecraft_servers.price_inr::float AS "priceInr",
  minecraft_servers.price_usd::float AS "priceUsd",
  minecraft_servers.ram_mb AS "ramMb",
  minecraft_servers.cpu_limit AS "cpuLimit",
  minecraft_servers.storage_mb AS "storageMb",
  minecraft_servers.allocation_id AS "allocationId",
  minecraft_servers.allocation_ip AS "allocationIp",
  minecraft_servers.allocation_port AS "allocationPort",
  minecraft_servers.customer_hostname AS "customerHostname",
  minecraft_servers.ssh_username AS "sshUsername",
  minecraft_servers.ssh_port AS "sshPort",
  minecraft_servers.billing_cycle_months AS "billingCycleMonths",
  minecraft_servers.provisioned_at AS "provisionedAt",
  minecraft_servers.expires_at AS "expiresAt",
  minecraft_servers.renewal_count AS "renewalCount",
  minecraft_servers.status,
  minecraft_servers.provisioned_by_discord_id AS "provisionedByDiscordId",
  minecraft_servers.created_at AS "createdAt",
  minecraft_servers.updated_at AS "updatedAt"
`;

function normalizeRecord(record: MinecraftServerRecord): MinecraftServerRecord {
  return {
    ...record,
    serverNumber: Number(record.serverNumber),
    pterodactylServerId: Number(record.pterodactylServerId),
    pterodactylUserId: Number(record.pterodactylUserId),
    customerMinecraftSequence: Number(record.customerMinecraftSequence),
    ramMb: Number(record.ramMb),
    cpuLimit: Number(record.cpuLimit),
    storageMb: Number(record.storageMb),
    allocationId: Number(record.allocationId),
    allocationPort: Number(record.allocationPort),
    billingCycleMonths: Number(record.billingCycleMonths),
    renewalCount: Number(record.renewalCount),
  };
}

export async function allocateCustomerMinecraftSequence(
  customerId: string
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ minecraftSequenceCounter: number }>(
      `UPDATE customers
       SET minecraft_sequence_counter = COALESCE(minecraft_sequence_counter, 0) + 1
       WHERE id = $1
       RETURNING minecraft_sequence_counter AS "minecraftSequenceCounter"`,
      [customerId]
    );

    if (!result.rows[0]) {
      throw new Error(`Customer record not found for ID: ${customerId}`);
    }

    await client.query("COMMIT");
    return Number(result.rows[0].minecraftSequenceCounter);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCustomerPterodactylUserId(
  customerId: string,
  pterodactylUserId: number
): Promise<void> {
  await pool.query(
    `UPDATE customers
     SET pterodactyl_user_id = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [pterodactylUserId, customerId]
  );
}

export async function getCustomerPterodactylUserId(
  customerId: string
): Promise<number | null> {
  const result = await pool.query<{ pterodactylUserId: number | null }>(
    `SELECT pterodactyl_user_id AS "pterodactylUserId"
     FROM customers
     WHERE id = $1
     LIMIT 1`,
    [customerId]
  );
  return result.rows[0]?.pterodactylUserId ? Number(result.rows[0].pterodactylUserId) : null;
}

export async function createMinecraftServer(
  input: CreateMinecraftServerInput
): Promise<MinecraftServerRecord> {
  const customerHostname = input.customerHostname?.trim() || "minecraft.mysticservers.com";

  const result = await pool.query<MinecraftServerRecord>(
    `
    INSERT INTO minecraft_servers (
      customer_id,
      ticket_id,
      pterodactyl_server_id,
      pterodactyl_identifier,
      pterodactyl_user_id,
      server_name,
      customer_minecraft_sequence,
      plan_id,
      plan_name,
      price_inr,
      price_usd,
      ram_mb,
      cpu_limit,
      storage_mb,
      allocation_id,
      allocation_ip,
      allocation_port,
      customer_hostname,
      ssh_username,
      ssh_port,
      status,
      provisioned_by_discord_id,
      billing_cycle_months,
      provisioned_at,
      expires_at,
      renewal_count
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13,
      $14,
      $15,
      $16,
      $17,
      $18,
      $19,
      $20,
      'active',
      $21,
      $22::integer,
      NOW(),
      NOW() + make_interval(months => $22::integer),
      0
    )
    RETURNING ${MINECRAFT_SELECT}
    `,
    [
      input.customerId,
      input.ticketId ?? null,
      input.pterodactylServerId,
      input.pterodactylIdentifier,
      input.pterodactylUserId,
      input.serverName,
      input.customerMinecraftSequence,
      input.planId,
      input.planName,
      input.priceInr,
      input.priceUsd,
      input.ramMb,
      input.cpuLimit,
      input.storageMb,
      input.allocationId,
      input.allocationIp,
      input.allocationPort,
      customerHostname,
      input.sshUsername ?? "root",
      input.sshPort ?? 22,
      input.provisionedByDiscordId,
      input.billingCycleMonths,
    ]
  );

  const created = result.rows[0];
  if (!created) {
    throw new Error("Failed to insert Minecraft server record.");
  }

  return normalizeRecord(created);
}

export async function listMinecraftServersByDiscordUserId(
  discordUserId: string
): Promise<MinecraftServerRecord[]> {
  const result = await pool.query<MinecraftServerRecord>(
    `SELECT ${MINECRAFT_SELECT}
     FROM minecraft_servers
     JOIN customers ON customers.id = minecraft_servers.customer_id
     WHERE customers.discord_user_id = $1
     ORDER BY minecraft_servers.created_at DESC`,
    [discordUserId]
  );

  return result.rows.map(normalizeRecord);
}

export async function getMinecraftServerByNumber(
  serverNumber: number
): Promise<MinecraftServerRecord | null> {
  const result = await pool.query<MinecraftServerRecord>(
    `SELECT ${MINECRAFT_SELECT}
     FROM minecraft_servers
     WHERE server_number = $1
     LIMIT 1`,
    [serverNumber]
  );

  return result.rows[0] ? normalizeRecord(result.rows[0]) : null;
}

export async function getMinecraftServerByTicketId(
  ticketId: string
): Promise<MinecraftServerRecord | null> {
  const result = await pool.query<MinecraftServerRecord>(
    `SELECT ${MINECRAFT_SELECT}
     FROM minecraft_servers
     WHERE ticket_id = $1
     LIMIT 1`,
    [ticketId]
  );

  return result.rows[0] ? normalizeRecord(result.rows[0]) : null;
}

export async function deleteMinecraftServerForRollback(
  id: string
): Promise<void> {
  await pool.query(
    `DELETE FROM minecraft_servers WHERE id = $1`,
    [id]
  );
}
