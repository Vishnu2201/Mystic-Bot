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
  publicIpv4?: string;
  privateIpv4?: string;
  ipv6?: string;
  sshUsername: string;
  sshPort: number;
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
  publicIpv4?: string;
  privateIpv4?: string;
  ipv6?: string;
  sshUsername: string;
  sshPort: number;
  provisionedByDiscordId: string;
  billingCycleMonths: number;
}

export async function getVpsByTicketId(
  ticketId: string
): Promise<VpsInstanceRecord | null> {
  const result = await pool.query<VpsInstanceRecord>(
    `
    SELECT
      id,
      vps_number AS "vpsNumber",
      customer_id AS "customerId",
      ticket_id AS "ticketId",
      plan_id AS "planId",
      plan_name AS "planName",
      location,
      price_inr::float AS "priceInr",
      price_usd::float AS "priceUsd",
      ram_gb AS "ramGb",
      vcpu,
      storage_gb AS "storageGb",
      provider_instance_id AS "providerInstanceId",
      hostname,
      public_ipv4::text AS "publicIpv4",
      private_ipv4::text AS "privateIpv4",
      ipv6::text AS "ipv6",
      ssh_username AS "sshUsername",
      ssh_port AS "sshPort",
      status,
      provisioned_by_discord_id AS "provisionedByDiscordId",
      billing_cycle_months AS "billingCycleMonths",
      provisioned_at AS "provisionedAt",
      expires_at AS "expiresAt",
      renewal_count AS "renewalCount",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM vps_instances
    WHERE ticket_id = $1
    LIMIT 1
    `,
    [ticketId]
  );

  return result.rows[0] ?? null;
}

export async function createVpsInstance(
  input: CreateVpsInstanceInput
): Promise<VpsInstanceRecord> {
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
      public_ipv4,
      private_ipv4,
      ipv6,
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
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, 'active', $18,
      $19, NOW(), NOW() + ($19 * INTERVAL '1 month'), 0
    )
    RETURNING
      id,
      vps_number AS "vpsNumber",
      customer_id AS "customerId",
      ticket_id AS "ticketId",
      plan_id AS "planId",
      plan_name AS "planName",
      location,
      price_inr::float AS "priceInr",
      price_usd::float AS "priceUsd",
      ram_gb AS "ramGb",
      vcpu,
      storage_gb AS "storageGb",
      provider_instance_id AS "providerInstanceId",
      hostname,
      public_ipv4::text AS "publicIpv4",
      private_ipv4::text AS "privateIpv4",
      ipv6::text AS "ipv6",
      ssh_username AS "sshUsername",
      ssh_port AS "sshPort",
      status,
      provisioned_by_discord_id AS "provisionedByDiscordId",
      billing_cycle_months AS "billingCycleMonths",
      provisioned_at AS "provisionedAt",
      expires_at AS "expiresAt",
      renewal_count AS "renewalCount",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    `,
    [
      input.customerId,
      input.ticketId,
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
      input.publicIpv4 ?? null,
      input.privateIpv4 ?? null,
      input.ipv6 ?? null,
      input.sshUsername,
      input.sshPort,
      input.provisionedByDiscordId,
      input.billingCycleMonths,
    ]
  );

  return result.rows[0];
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

export async function listVpsInstances(): Promise<VpsInstanceRecord[]> {
  const result = await pool.query<VpsInstanceRecord>(`
    SELECT
      id,
      vps_number AS "vpsNumber",
      customer_id AS "customerId",
      ticket_id AS "ticketId",
      plan_id AS "planId",
      plan_name AS "planName",
      location,
      price_inr::float AS "priceInr",
      price_usd::float AS "priceUsd",
      ram_gb AS "ramGb",
      vcpu,
      storage_gb AS "storageGb",
      provider_instance_id AS "providerInstanceId",
      hostname,
      public_ipv4::text AS "publicIpv4",
      private_ipv4::text AS "privateIpv4",
      ipv6::text AS "ipv6",
      ssh_username AS "sshUsername",
      ssh_port AS "sshPort",
      status,
      provisioned_by_discord_id AS "provisionedByDiscordId",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      billing_cycle_months AS "billingCycleMonths",
      provisioned_at AS "provisionedAt",
      expires_at AS "expiresAt",
      renewal_count AS "renewalCount"
    FROM vps_instances
    ORDER BY expires_at ASC
  `);
  return result.rows;
}

export async function getVpsByNumber(vpsNumber: number): Promise<VpsInstanceRecord | null> {
  const result = await pool.query<VpsInstanceRecord>(`
    SELECT
      id,
      vps_number AS "vpsNumber",
      customer_id AS "customerId",
      ticket_id AS "ticketId",
      plan_id AS "planId",
      plan_name AS "planName",
      location,
      price_inr::float AS "priceInr",
      price_usd::float AS "priceUsd",
      ram_gb AS "ramGb",
      vcpu,
      storage_gb AS "storageGb",
      provider_instance_id AS "providerInstanceId",
      hostname,
      public_ipv4::text AS "publicIpv4",
      private_ipv4::text AS "privateIpv4",
      ipv6::text AS "ipv6",
      ssh_username AS "sshUsername",
      ssh_port AS "sshPort",
      status,
      provisioned_by_discord_id AS "provisionedByDiscordId",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      billing_cycle_months AS "billingCycleMonths",
      provisioned_at AS "provisionedAt",
      expires_at AS "expiresAt",
      renewal_count AS "renewalCount"
    FROM vps_instances
    WHERE vps_number = $1
    LIMIT 1
  `, [vpsNumber]);
  return result.rows[0] ?? null;
}

export async function renewVps(
  vpsId: string,
  billingCycleMonths: number,
  renewedByDiscordId: string
): Promise<VpsInstanceRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query<VpsInstanceRecord>(`
      SELECT
        id,
        vps_number AS "vpsNumber",
        customer_id AS "customerId",
        ticket_id AS "ticketId",
        plan_id AS "planId",
        plan_name AS "planName",
        location,
        price_inr::float AS "priceInr",
        price_usd::float AS "priceUsd",
        ram_gb AS "ramGb",
        vcpu,
        storage_gb AS "storageGb",
        provider_instance_id AS "providerInstanceId",
        hostname,
        public_ipv4::text AS "publicIpv4",
        private_ipv4::text AS "privateIpv4",
        ipv6::text AS "ipv6",
        ssh_username AS "sshUsername",
        ssh_port AS "sshPort",
        status,
        provisioned_by_discord_id AS "provisionedByDiscordId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        billing_cycle_months AS "billingCycleMonths",
        provisioned_at AS "provisionedAt",
        expires_at AS "expiresAt",
        renewal_count AS "renewalCount"
      FROM vps_instances
      WHERE id = $1
      FOR UPDATE
    `, [vpsId]);

    const vps = current.rows[0];
    if (!vps) throw new Error("VPS not found.");

    const base = new Date(vps.expiresAt);
    const now = new Date();
    const start = base > now ? base : now;
    const newExpiry = new Date(start);
    newExpiry.setMonth(newExpiry.getMonth() + billingCycleMonths);

    const amountInr = vps.priceInr * billingCycleMonths;
    const amountUsd = vps.priceUsd * billingCycleMonths;

    await client.query(`
      UPDATE vps_instances
      SET
        billing_cycle_months = $2,
        expires_at = $3,
        status = 'active',
        renewal_count = renewal_count + 1,
        updated_at = NOW()
      WHERE id = $1
    `, [vpsId, billingCycleMonths, newExpiry]);

    await client.query(`
      INSERT INTO vps_renewals (
        vps_id,
        billing_cycle_months,
        amount_inr,
        amount_usd,
        previous_expiry,
        new_expiry,
        renewed_by_discord_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      vpsId,
      billingCycleMonths,
      amountInr,
      amountUsd,
      vps.expiresAt,
      newExpiry,
      renewedByDiscordId,
    ]);

    await client.query("COMMIT");

    const updated = await getVpsByNumber(vps.vpsNumber);
    if (!updated) throw new Error("VPS disappeared after renewal.");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markExpiredVps(): Promise<number> {
  const result = await pool.query(`
    UPDATE vps_instances
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active'
      AND expires_at <= NOW()
  `);
  return result.rowCount ?? 0;
}

export async function claimExpiryNotification(
  vpsId: string,
  expiryDate: Date,
  noticeType: string
): Promise<boolean> {
  const result = await pool.query(`
    INSERT INTO vps_expiry_notifications (
      vps_id,
      expiry_date,
      notice_type
    ) VALUES ($1, $2::date, $3)
    ON CONFLICT (vps_id, expiry_date, notice_type) DO NOTHING
    RETURNING id
  `, [vpsId, expiryDate, noticeType]);
  return (result.rowCount ?? 0) > 0;
}
