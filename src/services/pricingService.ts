import { pool } from "../config/database";

export interface PricingPlan {
  id: string;
  name: string;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  priceInr: number;
  priceUsd: number;
}

export interface IPv4Plan {
  id: string;
  durationMonths: number;
  priceInr: number;
}

export async function getPricingPlans(): Promise<PricingPlan[]> {
  const result =
    await pool.query<PricingPlan>(
      `
      SELECT
        id,
        name,
        ram_gb AS "ramGb",
        vcpu,
        storage_gb AS "storageGb",
        price_inr::float AS "priceInr",
        price_usd::float AS "priceUsd"
      FROM pricing_plans
      WHERE is_active = TRUE
      ORDER BY price_inr ASC
      `
    );

  return result.rows;
}

export async function getIPv4Plans(): Promise<IPv4Plan[]> {
  const result =
    await pool.query<IPv4Plan>(
      `
      SELECT
        id,
        duration_months AS "durationMonths",
        price_inr::float AS "priceInr"
      FROM pricing_ipv4
      WHERE is_active = TRUE
      ORDER BY duration_months ASC
      `
    );

  return result.rows;
}

export async function getPricingPlanById(
  id: string
): Promise<PricingPlan | null> {
  const result =
    await pool.query<PricingPlan>(
      `
      SELECT
        id,
        name,
        ram_gb AS "ramGb",
        vcpu,
        storage_gb AS "storageGb",
        price_inr::float AS "priceInr",
        price_usd::float AS "priceUsd"
      FROM pricing_plans
      WHERE id = $1
        AND is_active = TRUE
      LIMIT 1
      `,
      [id]
    );

  return result.rows[0] ?? null;
}