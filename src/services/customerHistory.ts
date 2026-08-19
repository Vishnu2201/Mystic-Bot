import { pool } from "../config/database";

export interface CustomerHistoryCustomer {
  id: string;
  discordUserId: string;
  username?: string;
  displayName?: string;
}

export interface CustomerHistoryTicket {
  id: string;
  ticketNumber: number;
  department: string;
  status: string;
  discordChannelId?: string;
  claimedByDiscordId?: string;
  createdAt?: Date;
  claimedAt?: Date;
  closedAt?: Date;

  location?: string;
  planName?: string;
  priceInr?: number;
  priceUsd?: number;
  ramGb?: number;
  storageGb?: number;
  vcpu?: number;
}

export interface CustomerHistoryResult {
  customer: CustomerHistoryCustomer;
  tickets: CustomerHistoryTicket[];
}

export async function getCustomerHistory(
  discordUserId: string
): Promise<CustomerHistoryResult | null> {
  const customerResult =
    await pool.query<CustomerHistoryCustomer>(
      `
      SELECT
        id,
        discord_user_id AS "discordUserId",
        username,
        display_name AS "displayName"
      FROM customers
      WHERE discord_user_id = $1
      LIMIT 1
      `,
      [discordUserId]
    );

  const customer =
    customerResult.rows[0];

  if (!customer) {
    return null;
  }

  const ticketResult =
    await pool.query<CustomerHistoryTicket>(
      `
      SELECT
        t.id,
        t.ticket_number AS "ticketNumber",
        t.department,
        t.status,
        t.discord_channel_id AS "discordChannelId",
        t.claimed_by_discord_id AS "claimedByDiscordId",
        t.created_at AS "createdAt",
        t.claimed_at AS "claimedAt",
        t.closed_at AS "closedAt",

        created_event.metadata->>'location' AS location,
        created_event.metadata->>'planName' AS "planName",
        NULLIF(created_event.metadata->>'priceInr', '')::float AS "priceInr",
        NULLIF(created_event.metadata->>'priceUsd', '')::float AS "priceUsd",
        NULLIF(created_event.metadata->>'ramGb', '')::int AS "ramGb",
        NULLIF(created_event.metadata->>'storageGb', '')::int AS "storageGb",
        NULLIF(created_event.metadata->>'vcpu', '')::int AS vcpu

      FROM tickets t

      LEFT JOIN LATERAL (
        SELECT metadata
        FROM ticket_events
        WHERE
          ticket_id = t.id
          AND event_type = 'created'
        ORDER BY created_at ASC
        LIMIT 1
      ) created_event ON TRUE

      WHERE t.customer_id = $1

      ORDER BY t.created_at DESC
      LIMIT 50
      `,
      [customer.id]
    );

  return {
    customer,
    tickets: ticketResult.rows,
  };
}
