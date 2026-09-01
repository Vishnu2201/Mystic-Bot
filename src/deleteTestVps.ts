import "dotenv/config";
import {
  deleteVpsInstance,
  getVpsByNumber,
} from "./services/vpsDatabase";

async function main() {
  try {
    const vps = await getVpsByNumber(1);

    if (!vps) {
      console.log("No VPS found with number 1.");
      return;
    }

    console.log("Deleting VPS:");
    console.dir(vps, { depth: null });

    const deleted = await deleteVpsInstance(vps.id);

    if (!deleted) {
      console.log("VPS could not be deleted.");
      return;
    }

    console.log("✅ VPS deleted successfully:");
    console.dir(deleted, { depth: null });
  } catch (error) {
    console.error("Failed to delete VPS:", error);
    process.exitCode = 1;
  }
}

main();