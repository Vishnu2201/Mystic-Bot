import "dotenv/config";
import { pool } from "./database";

async function testDatabase(): Promise<void> {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");

    console.log("✅ PostgreSQL connection successful.");
    console.log(`🕒 Database time: ${result.rows[0].current_time}`);
  } catch (error) {
    console.error("❌ PostgreSQL connection failed:");
    console.error(error);
  } finally {
    await pool.end();
  }
}

testDatabase();