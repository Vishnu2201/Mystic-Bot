import { PoolClient } from "pg";
import { pool } from "../config/database";

export interface VpsInstanceRecord {
  id: string;
  vpsNumber: number;
  customerId: string;
  ticketId: string;
  planId?: string;
  planName: string;
  location: string;
  priceInr: number;
  priceUsd: number;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  providerInstanceId: string;
  hostname: string;
  instanceName?: string;
  customerVpsSequence?: number;
  publicIpv4?: string;
  privateIpv4?: string;
  ipv6?: string;
  sshUsername: string;
  sshPort: number;
  publicSshHost?: string;
  publicSshPort?: number;
  publicSshTargetHost?: string;
  publicSshTargetPort?: number;
  publicSshStatus?: string;
  publicSshLastVerifiedAt?: Date;
  storageLimitRequested?: number;
  storageLimitEnforced?: boolean;
  storageBackend?: string;
  storageStatus?: string;
  status: string;
  provisionedByDiscordId: string;
  createdAt?: Date;
  updatedAt?: Date;
  billingCycleMonths: number;
  provisionedAt?: Date;
  expiresAt: Date;
  renewalCount: number;
}

export interface CreateVpsInstanceInput {
  customerId: string;
  ticketId?: string;
  planId?: string;
  planName: string;
  location: string;
  priceInr: number;
  priceUsd: number;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  providerInstanceId: string;
  hostname: string;
  instanceName?: string;
  customerVpsSequence?: number;
  publicIpv4?: string;
  privateIpv4?: string;
  ipv6?: string;
  sshUsername: string;
  sshPort: number;
  publicSshHost?: string;
  publicSshPort?: number;
  publicSshTargetHost?: string;
  publicSshTargetPort?: number;
  publicSshStatus?: string;
  storageLimitRequested?: number;
  storageLimitEnforced?: boolean;
  storageBackend?: string;
  storageStatus?: string;
  provisionedByDiscordId: string;
  billingCycleMonths: number;
}

export interface VpsRenewalRecord {
  id: string;
  vpsId: string;
  vpsNumber: number;
  billingCycleMonths: number;
  amountInr: number;
  amountUsd: number;
  previousExpiry: Date;
  newExpiry: Date;
  renewedAt: Date;
  renewedByDiscordId: string;
}

const VPS_SELECT = `
  vps_instances.id,
  vps_instances.vps_number AS "vpsNumber",
  vps_instances.customer_id AS "customerId",
  vps_instances.ticket_id AS "ticketId",
  vps_instances.plan_id AS "planId",
  vps_instances.plan_name AS "planName",
  vps_instances.location,
  vps_instances.price_inr::float AS "priceInr",
  vps_instances.price_usd::float AS "priceUsd",
  vps_instances.ram_gb AS "ramGb",
  vps_instances.vcpu,
  vps_instances.storage_gb AS "storageGb",
  vps_instances.provider_instance_id AS "providerInstanceId",
  vps_instances.hostname,
  vps_instances.instance_name AS "instanceName",
  vps_instances.customer_vps_sequence AS "customerVpsSequence",
  vps_instances.public_ipv4::text AS "publicIpv4",
  vps_instances.private_ipv4::text AS "privateIpv4",
  vps_instances.ipv6::text AS "ipv6",
  vps_instances.ssh_username AS "sshUsername",
  vps_instances.ssh_port AS "sshPort",
  vps_instances.public_ssh_host AS "publicSshHost",
  vps_instances.public_ssh_port AS "publicSshPort",
  vps_instances.public_ssh_target_host::text AS "publicSshTargetHost",
  vps_instances.public_ssh_target_port AS "publicSshTargetPort",
  vps_instances.public_ssh_status AS "publicSshStatus",
  vps_instances.public_ssh_last_verified_at AS "publicSshLastVerifiedAt",
  vps_instances.storage_limit_requested AS "storageLimitRequested",
  vps_instances.storage_limit_enforced AS "storageLimitEnforced",
  vps_instances.storage_backend AS "storageBackend",
  vps_instances.storage_status AS "storageStatus",
  vps_instances.status,
  vps_instances.provisioned_by_discord_id AS "provisionedByDiscordId",
  vps_instances.billing_cycle_months AS "billingCycleMonths",
  vps_instances.provisioned_at AS "provisionedAt",
  vps_instances.expires_at AS "expiresAt",
  vps_instances.renewal_count AS "renewalCount",
  vps_instances.created_at AS "createdAt",
  vps_instances.updated_at AS "updatedAt"
`;

export async function allocatePrivateIpv4(
  client?: PoolClient
): Promise<string> {
  const queryClient = client || pool;
  const result = await queryClient.query<{ privateIpv4: string }>(
    `SELECT private_ipv4::text AS "privateIpv4"
     FROM vps_instances
     WHERE status != 'deleted' AND private_ipv4 IS NOT NULL`
  );

  const usedIps = new Set(result.rows.map((r) => r.privateIpv4));

  for (let hostNum = 10; hostNum <= 250; hostNum++) {
    const candidateIp = `10.0.3.${hostNum}`;
    if (!usedIps.has(candidateIp)) {
      return candidateIp;
    }
  }

  throw new Error("No available private IPv4 addresses in subnet 10.0.3.0/24 (range 10.0.3.10 - 10.0.3.250).");
}

export async function allocatePublicSshPort(
  client?: PoolClient
): Promise<{ publicSshHost: string; publicSshPort: number }> {
  const queryClient = client || pool;
  const result = await queryClient.query<{ publicSshPort: number }>(
    `SELECT public_ssh_port AS "publicSshPort"
     FROM vps_instances
     WHERE status != 'deleted' AND public_ssh_port IS NOT NULL`
  );

  const usedPorts = new Set(result.rows.map((r) => Number(r.publicSshPort)));

  for (let port = 22001; port <= 22100; port++) {
    if (!usedPorts.has(port)) {
      return {
        publicSshHost: process.env.PUBLIC_SSH_HOST?.trim() || "ssh.mysticservers.com",
        publicSshPort: port,
      };
    }
  }

  throw new Error("No available public SSH ports in range 22001-22100.");
}

function normalizeVpsRecord(record: VpsInstanceRecord): VpsInstanceRecord {
  const vpsNumber = Number(record.vpsNumber);

  if (!Number.isSafeInteger(vpsNumber) || vpsNumber < 1) {
    throw new Error(`Database returned an invalid VPS number: ${String(record.vpsNumber)}`);
  }

  return { ...record, vpsNumber };
}

export async function getVpsByTicketId(
  ticketId: string
): Promise<VpsInstanceRecord | null> {
  const result = await pool.query<VpsInstanceRecord>(
    `
    SELECT ${VPS_SELECT}
    FROM vps_instances
    WHERE ticket_id = $1
    LIMIT 1
    `,
    [ticketId]
  );

  return result.rows[0] ? normalizeVpsRecord(result.rows[0]) : null;
}

export async function getVpsByNumber(
  vpsNumber: number
): Promise<VpsInstanceRecord | null> {
  const result = await pool.query<VpsInstanceRecord>(
    `
    SELECT ${VPS_SELECT}
    FROM vps_instances
    WHERE vps_number = $1
    LIMIT 1
    `,
    [vpsNumber]
  );

  return result.rows[0] ? normalizeVpsRecord(result.rows[0]) : null;
}

export async function getVpsById(
  vpsId: string
): Promise<VpsInstanceRecord | null> {
  const result = await pool.query<VpsInstanceRecord>(
    `
    SELECT ${VPS_SELECT}
    FROM vps_instances
    WHERE id = $1
    LIMIT 1
    `,
    [vpsId]
  );

  return result.rows[0] ? normalizeVpsRecord(result.rows[0]) : null;
}

export async function listVpsInstances(): Promise<VpsInstanceRecord[]> {
  const result = await pool.query<VpsInstanceRecord>(
    `
    SELECT ${VPS_SELECT}
    FROM vps_instances
    ORDER BY expires_at ASC
    `
  );

  return result.rows.map(normalizeVpsRecord);
}

export async function listVpsByDiscordUserId(discordUserId: string): Promise<VpsInstanceRecord[]> {
  const result = await pool.query<VpsInstanceRecord>(
    `SELECT ${VPS_SELECT}
     FROM vps_instances
     INNER JOIN customers ON customers.id = vps_instances.customer_id
     WHERE customers.discord_user_id = $1
     ORDER BY vps_instances.created_at DESC`,
    [discordUserId]
  );

  return result.rows.map(normalizeVpsRecord);
}

export async function allocateCustomerVpsSequence(
  customerId: string
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ vpsSequenceCounter: number }>(
      `UPDATE customers
       SET vps_sequence_counter = COALESCE(vps_sequence_counter, 0) + 1
       WHERE id = $1
       RETURNING vps_sequence_counter AS "vpsSequenceCounter"`,
      [customerId]
    );

    if (!result.rows[0]) {
      throw new Error(`Customer record not found for ID: ${customerId}`);
    }

    await client.query("COMMIT");
    return Number(result.rows[0].vpsSequenceCounter);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createVpsInstance(
  input: CreateVpsInstanceInput
): Promise<VpsInstanceRecord> {
  const publicSshHost =
    input.publicSshHost?.trim() ||
    process.env.PUBLIC_SSH_HOST?.trim() ||
    "ssh.mysticservers.com";

  let publicSshPort = input.publicSshPort;
  if (!publicSshPort) {
    const allocated = await allocatePublicSshPort();
    publicSshPort = allocated.publicSshPort;
  }

  let privateIpv4 = input.privateIpv4;
  if (!privateIpv4) {
    privateIpv4 = await allocatePrivateIpv4();
  }

  const publicSshTargetHost = input.publicSshTargetHost || privateIpv4;
  const publicSshTargetPort = input.publicSshTargetPort ?? 22;
  const publicSshStatus = input.publicSshStatus || "unverified";
  const storageLimitRequested = input.storageLimitRequested ?? input.storageGb;
  const storageLimitEnforced = input.storageLimitEnforced ?? false;
  const storageBackend = input.storageBackend || "directory";
  const storageStatus = input.storageStatus || "unbounded_directory";

  const result = await pool.query<VpsInstanceRecord>(
    `
    INSERT INTO vps_instances (
      customer_id,
      ticket_id,
      plan_id,
      plan_name,
      location,
      price_inr,
      price_usd,
      ram_gb,
      vcpu,
      storage_gb,
      provider_instance_id,
      hostname,
      instance_name,
      customer_vps_sequence,
      public_ipv4,
      private_ipv4,
      ipv6,
      ssh_username,
      ssh_port,
      public_ssh_host,
      public_ssh_port,
      public_ssh_target_host,
      public_ssh_target_port,
      public_ssh_status,
      storage_limit_requested,
      storage_limit_enforced,
      storage_backend,
      storage_status,
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
      $15::inet,
      $16::inet,
      $17::inet,
      $18,
      $19,
      $20,
      $21,
      $22,
      $23,
      $24,
      $25,
      $26,
      $27,
      $28,
      'active',
      $29,
      $30::integer,
      NOW(),
      NOW() + make_interval(months => $30::integer),
      0
    )
    RETURNING ${VPS_SELECT}
    `,
    [
      input.customerId,
      input.ticketId ?? null,
      input.planId ?? null,
      input.planName,
      input.location,
      input.priceInr,
      input.priceUsd,
      input.ramGb,
      input.vcpu,
      input.storageGb,
      input.providerInstanceId,
      input.hostname,
      input.instanceName ?? input.providerInstanceId,
      input.customerVpsSequence ?? null,
      input.publicIpv4 ?? null,
      privateIpv4,
      input.ipv6 ?? null,
      input.sshUsername,
      input.sshPort,
      publicSshHost,
      publicSshPort,
      publicSshTargetHost,
      publicSshTargetPort,
      publicSshStatus,
      storageLimitRequested,
      storageLimitEnforced,
      storageBackend,
      storageStatus,
      input.provisionedByDiscordId,
      input.billingCycleMonths,
    ]
  );

  const created = result.rows[0];

  if (!created) {
    throw new Error("Failed to create VPS instance.");
  }

  return normalizeVpsRecord(created);
}

export async function renewVps(
  vpsId: string,
  billingCycleMonths: number,
  renewedByDiscordId: string
): Promise<VpsInstanceRecord> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current = await client.query<VpsInstanceRecord>(
      `
      SELECT ${VPS_SELECT}
      FROM vps_instances
      WHERE id = $1
      FOR UPDATE
      `,
      [vpsId]
    );

    const vps = current.rows[0];

    if (!vps) {
      throw new Error("VPS not found.");
    }

    const now = new Date();
    const currentExpiry = new Date(vps.expiresAt);

    const startDate =
      currentExpiry.getTime() > now.getTime()
        ? currentExpiry
        : now;

    const newExpiry = new Date(startDate);

    newExpiry.setMonth(
      newExpiry.getMonth() + billingCycleMonths
    );

    const amountInr =
      Number(vps.priceInr) * billingCycleMonths;

    const amountUsd =
      Number(vps.priceUsd) * billingCycleMonths;

    const updatedResult =
      await client.query<VpsInstanceRecord>(
        `
        UPDATE vps_instances
        SET
          billing_cycle_months = $2,
          expires_at = $3,
          status = 'active',
          renewal_count = renewal_count + 1,
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${VPS_SELECT}
        `,
        [
          vpsId,
          billingCycleMonths,
          newExpiry,
        ]
      );

    await client.query(
      `
      INSERT INTO vps_renewals (
        vps_id,
        billing_cycle_months,
        amount_inr,
        amount_usd,
        previous_expiry,
        new_expiry,
        renewed_by_discord_id
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7
      )
      `,
      [
        vpsId,
        billingCycleMonths,
        amountInr,
        amountUsd,
        vps.expiresAt,
        newExpiry,
        renewedByDiscordId,
      ]
    );

    await client.query("COMMIT");

    const updated = updatedResult.rows[0];

    if (!updated) {
      throw new Error(
        "VPS renewal completed but updated VPS could not be returned."
      );
    }

    return normalizeVpsRecord(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markExpiredVps(): Promise<number> {
  const result = await pool.query(
    `
    UPDATE vps_instances
    SET
      status = 'expired',
      updated_at = NOW()
    WHERE status = 'active'
      AND expires_at <= NOW()
    `
  );

  return result.rowCount ?? 0;
}

export async function claimExpiryNotification(
  vpsId: string,
  expiryDate: Date,
  noticeType: string
): Promise<boolean> {
  const result = await pool.query(
    `
    INSERT INTO vps_expiry_notifications (
      vps_id,
      expiry_date,
      notice_type
    )
    VALUES ($1, $2::date, $3)
    ON CONFLICT (
      vps_id,
      expiry_date,
      notice_type
    )
    DO NOTHING
    RETURNING id
    `,
    [
      vpsId,
      expiryDate,
      noticeType,
    ]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function deleteVpsInstance(
  id: string
): Promise<VpsInstanceRecord | null> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Delete renewal history associated with this VPS first.
    await client.query(
      `
        DELETE FROM vps_renewals
        WHERE vps_id = $1
      `,
      [id]
    );

    // Delete expiry notification history associated with this VPS.
    await client.query(
      `
        DELETE FROM vps_expiry_notifications
        WHERE vps_id = $1
      `,
      [id]
    );

    // Delete the VPS instance itself.
    const result = await client.query<VpsInstanceRecord>(
      `
        DELETE FROM vps_instances
        WHERE id = $1
        RETURNING ${VPS_SELECT}
      `,
      [id]
    );

    await client.query("COMMIT");

    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function updateVpsProvisioningDetails(input: {
  id: string;
  providerInstanceId: string;
  hostname: string;
  privateIpv4?: string;
  sshUsername: string;
  sshPort: number;
  publicSshHost?: string;
  publicSshPort?: number;
  publicSshTargetHost?: string;
  publicSshTargetPort?: number;
  publicSshStatus?: string;
  publicSshLastVerifiedAt?: Date;
  storageLimitRequested?: number;
  storageLimitEnforced?: boolean;
  storageBackend?: string;
  storageStatus?: string;
}): Promise<VpsInstanceRecord> {
  const result = await pool.query<VpsInstanceRecord>(
    `UPDATE vps_instances
     SET provider_instance_id=$2,
         hostname=$3,
         private_ipv4=COALESCE($4::inet, private_ipv4),
         ssh_username=$5,
         ssh_port=$6,
         public_ssh_host=COALESCE($7, public_ssh_host),
         public_ssh_port=COALESCE($8, public_ssh_port),
         public_ssh_target_host=COALESCE($9, public_ssh_target_host, $4::text, private_ipv4::text),
         public_ssh_target_port=COALESCE($10, public_ssh_target_port, 22),
         public_ssh_status=COALESCE($11, public_ssh_status),
         public_ssh_last_verified_at=COALESCE($12, public_ssh_last_verified_at),
         storage_limit_requested=COALESCE($13, storage_limit_requested),
         storage_limit_enforced=COALESCE($14, storage_limit_enforced),
         storage_backend=COALESCE($15, storage_backend),
         storage_status=COALESCE($16, storage_status),
         updated_at=NOW()
     WHERE id=$1
     RETURNING ${VPS_SELECT}`,
    [
      input.id,
      input.providerInstanceId,
      input.hostname,
      input.privateIpv4 ?? null,
      input.sshUsername,
      input.sshPort,
      input.publicSshHost ?? null,
      input.publicSshPort ?? null,
      input.publicSshTargetHost ?? null,
      input.publicSshTargetPort ?? null,
      input.publicSshStatus ?? null,
      input.publicSshLastVerifiedAt ?? null,
      input.storageLimitRequested ?? null,
      input.storageLimitEnforced ?? null,
      input.storageBackend ?? null,
      input.storageStatus ?? null,
    ]
  );
  if (!result.rows[0]) throw new Error("VPS record not found while finalizing provisioning.");
  return normalizeVpsRecord(result.rows[0]);
}

export async function deleteVpsInstanceForProvisionRollback(id: string): Promise<void> {
  await pool.query("DELETE FROM vps_expiry_notifications WHERE vps_id=$1", [id]);
  await pool.query("DELETE FROM vps_instances WHERE id=$1", [id]);
}

export async function decommissionVpsInstance(
  id: string
): Promise<VpsInstanceRecord | null> {
  const result = await pool.query<VpsInstanceRecord>(
    `UPDATE vps_instances
     SET status = 'deleted',
         updated_at = NOW()
     WHERE id = $1 AND status != 'deleted'
     RETURNING ${VPS_SELECT}`,
    [id]
  );
  return result.rows[0] ? normalizeVpsRecord(result.rows[0]) : null;
}
