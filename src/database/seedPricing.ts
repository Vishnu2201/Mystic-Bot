import "dotenv/config";

import { pool } from "../config/database";

const plans = [
  ["Nano", 5, 2, 50, 99, 1.09],
  ["Basic", 6, 2, 60, 129, 1.39],
  ["Plus", 8, 2, 70, 169, 1.79],
  ["Pro", 10, 3, 80, 219, 2.39],
  ["Advanced", 12, 3, 85, 279, 2.99],
  ["Power", 14, 4, 90, 329, 3.49],
  ["Ultra", 16, 4, 95, 399, 4.49],
  ["Extreme", 20, 6, 98, 499, 5.49],
  ["Max", 24, 6, 100, 599, 6.49],
];

const ipv4Plans = [
  [6, 299],
  [12, 499],
  [18, 699],
  [24, 899],
];

async function seedPricing(): Promise<void> {
  try {
    console.log("🌐 Seeding MysticServers pricing...");

    for (const plan of plans) {
      await pool.query(
        `
        INSERT INTO pricing_plans (
          name,
          ram_gb,
          vcpu,
          storage_gb,
          price_inr,
          price_usd
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (name)
        DO UPDATE SET
          ram_gb = EXCLUDED.ram_gb,
          vcpu = EXCLUDED.vcpu,
          storage_gb = EXCLUDED.storage_gb,
          price_inr = EXCLUDED.price_inr,
          price_usd = EXCLUDED.price_usd,
          updated_at = NOW()
        `,
        plan
      );
    }

    for (const ipv4 of ipv4Plans) {
      await pool.query(
        `
        INSERT INTO pricing_ipv4 (
          duration_months,
          price_inr
        )
        VALUES ($1, $2)
        ON CONFLICT (duration_months)
        DO UPDATE SET
          price_inr = EXCLUDED.price_inr,
          updated_at = NOW()
        `,
        ipv4
      );
    }

    console.log("✅ Pricing seeded successfully.");
  } catch (error) {
    console.error(
      "❌ Failed to seed pricing:",
      error
    );

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seedPricing();