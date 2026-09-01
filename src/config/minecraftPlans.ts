import {
  getMinecraftPlans as getDbMinecraftPlans,
  getMinecraftPlanById as getDbMinecraftPlanById,
  CatalogPlan,
} from "../services/pricingService";

export interface MinecraftPlan {
  id: string;
  name: string;
  priceInr: number;
  priceUsd: number;
  cpuPercent: number;
  ramGb: number;
  ramMb: number;
  storageGb: number;
  storageMb: number;
}

/**
 * Static fallback plans array used only if DB is initializing.
 * Runtime pricing source is PostgreSQL pricing_plans table.
 */
export const MINECRAFT_PLANS: MinecraftPlan[] = [
  { id: "mc-starter", name: "Starter", priceInr: 49, priceUsd: 1, cpuPercent: 100, ramGb: 2, ramMb: 2048, storageGb: 10, storageMb: 10240 },
  { id: "mc-basic", name: "Basic", priceInr: 99, priceUsd: 1.5, cpuPercent: 150, ramGb: 4, ramMb: 4096, storageGb: 20, storageMb: 20480 },
  { id: "mc-advanced", name: "Advanced", priceInr: 149, priceUsd: 2, cpuPercent: 250, ramGb: 6, ramMb: 6144, storageGb: 30, storageMb: 30720 },
  { id: "mc-pro", name: "Pro", priceInr: 199, priceUsd: 2.5, cpuPercent: 300, ramGb: 8, ramMb: 8192, storageGb: 40, storageMb: 40960 },
  { id: "mc-elite", name: "Elite", priceInr: 299, priceUsd: 4, cpuPercent: 350, ramGb: 12, ramMb: 12288, storageGb: 60, storageMb: 61440 },
  { id: "mc-ultimate", name: "Ultimate", priceInr: 16, priceUsd: 5, cpuPercent: 400, ramGb: 16, ramMb: 16384, storageGb: 80, storageMb: 81920 },
  { id: "mc-extreme", name: "Extreme", priceInr: 699, priceUsd: 8, cpuPercent: 550, ramGb: 32, ramMb: 32768, storageGb: 100, storageMb: 102400 },
  { id: "mc-titan", name: "Titan", priceInr: 1399, priceUsd: 17, cpuPercent: 800, ramGb: 64, ramMb: 65536, storageGb: 160, storageMb: 163840 },
];

export function mapCatalogToMinecraftPlan(catalog: CatalogPlan): MinecraftPlan {
  const ramGb = catalog.ramGb || Math.round((catalog.memoryMb || 2048) / 1024);
  const ramMb = catalog.memoryMb || ramGb * 1024;
  const cpuPercent = catalog.cpuPercent || (catalog.vcpu || 1) * 100;
  const storageGb = catalog.storageGb || 10;
  const storageMb = storageGb * 1024;

  return {
    id: catalog.id,
    name: catalog.name,
    priceInr: catalog.priceInr,
    priceUsd: catalog.priceUsd,
    cpuPercent,
    ramGb,
    ramMb,
    storageGb,
    storageMb,
  };
}

export async function getMinecraftPlans(): Promise<MinecraftPlan[]> {
  const dbPlans = await getDbMinecraftPlans(false);
  if (dbPlans.length > 0) {
    return dbPlans.map(mapCatalogToMinecraftPlan);
  }
  return MINECRAFT_PLANS;
}

export async function getMinecraftPlanById(planId: string): Promise<MinecraftPlan | undefined> {
  const catalog = await getDbMinecraftPlanById(planId);
  if (catalog) {
    return mapCatalogToMinecraftPlan(catalog);
  }

  const fallback = MINECRAFT_PLANS.find(
    (plan) => plan.id.toLowerCase() === planId.toLowerCase() || plan.name.toLowerCase() === planId.toLowerCase()
  );

  return fallback;
}
