import { Pool } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing from .env`);
  }

  return value;
}

export const pool = new Pool({
  connectionString: requireEnv("DATABASE_URL"),

  ssl: {
    rejectUnauthorized: false,
  },

  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  console.error(
    "❌ Unexpected PostgreSQL pool error:",
    error
  );
});