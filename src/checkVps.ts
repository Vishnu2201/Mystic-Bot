import "dotenv/config";
import { listVpsInstances } from "./services/vpsDatabase";

async function main() {
  try {
    const vpsList = await listVpsInstances();

    console.log(`Found ${vpsList.length} VPS instance(s):\n`);

    for (const vps of vpsList) {
      console.log({
        id: vps.id,
        vpsNumber: vps.vpsNumber,
        planName: vps.planName,
        location: vps.location,
        status: vps.status,
        expiresAt: vps.expiresAt,
        customerId: vps.customerId,
      });
    }

    process.exit(0);
  } catch (error) {
    console.error("Failed to check VPS instances:", error);
    process.exit(1);
  }
}

main();