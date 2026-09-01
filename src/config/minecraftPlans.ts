export interface MinecraftPlan {
  id: string;
  name: string;
  priceInr: number;
  priceUsd: number;
  cpuPercent: number; // 100% = 100 (1 core), 150% = 150 (1.5 cores), etc.
  ramGb: number;
  ramMb: number;
  storageGb: number;
  storageMb: number;
}

export const MINECRAFT_PLANS: MinecraftPlan[] = [
  {
    id: "mc-starter",
    name: "Starter",
    priceInr: 49,
    priceUsd: 1,
    cpuPercent: 100,
    ramGb: 2,
    ramMb: 2048,
    storageGb: 10,
    storageMb: 10240,
  },
  {
    id: "mc-basic",
    name: "Basic",
    priceInr: 99,
    priceUsd: 1.5,
    cpuPercent: 150,
    ramGb: 4,
    ramMb: 4096,
    storageGb: 20,
    storageMb: 20480,
  },
  {
    id: "mc-advanced",
    name: "Advanced",
    priceInr: 149,
    priceUsd: 2,
    cpuPercent: 250,
    ramGb: 6,
    ramMb: 6144,
    storageGb: 30,
    storageMb: 30720,
  },
  {
    id: "mc-pro",
    name: "Pro",
    priceInr: 199,
    priceUsd: 2.5,
    cpuPercent: 300,
    ramGb: 8,
    ramMb: 8192,
    storageGb: 40,
    storageMb: 40960,
  },
  {
    id: "mc-elite",
    name: "Elite",
    priceInr: 299,
    priceUsd: 4,
    cpuPercent: 350,
    ramGb: 12,
    ramMb: 12288,
    storageGb: 60,
    storageMb: 61440,
  },
  {
    id: "mc-ultimate",
    name: "Ultimate",
    priceInr: 399,
    priceUsd: 5,
    cpuPercent: 400,
    ramGb: 16,
    ramMb: 16384,
    storageGb: 80,
    storageMb: 81920,
  },
  {
    id: "mc-extreme",
    name: "Extreme",
    priceInr: 699,
    priceUsd: 8,
    cpuPercent: 550,
    ramGb: 32,
    ramMb: 32768,
    storageGb: 100,
    storageMb: 102400,
  },
  {
    id: "mc-titan",
    name: "Titan",
    priceInr: 1399,
    priceUsd: 17,
    cpuPercent: 800,
    ramGb: 64,
    ramMb: 65536,
    storageGb: 160,
    storageMb: 163840,
  },
];

export function getMinecraftPlans(): MinecraftPlan[] {
  return MINECRAFT_PLANS;
}

export function getMinecraftPlanById(planId: string): MinecraftPlan | undefined {
  return MINECRAFT_PLANS.find(
    (plan) => plan.id.toLowerCase() === planId.toLowerCase() || plan.name.toLowerCase() === planId.toLowerCase()
  );
}
