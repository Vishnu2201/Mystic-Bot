import { Pool } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing from .env`);
  }

  return value;
}

const databaseUrl = requireEnv("DATABASE_URL");

const isLocalDatabase =
  databaseUrl.includes("localhost") ||
  databaseUrl.includes("127.0.0.1");

export const pool = new Pool({
  connectionString: databaseUrl,

  ssl: isLocalDatabase
    ? false
    : {
        rejectUnauthorized: false,
      },

  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (error) => {
  console.error("❌ Unexpected PostgreSQL pool error:", error);
});

export async function testDatabaseConnection(): Promise<void> {
  const client = await pool.connect();

  try {
    const result = await client.query(
      "SELECT current_database() AS database_name, NOW() AS connected_at"
    );

    console.log(
      `✅ Database connected: ${result.rows[0].database_name}`
    );
  } finally {
    client.release();
  }
}