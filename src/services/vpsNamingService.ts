import { allocateCustomerVpsSequence } from "./vpsDatabase";

/**
 * Sanitizes a customer username into a safe, valid container/hostname slug.
 * Allows only lowercase letters, numbers, and hyphens.
 * Collapses repeated hyphens and strips leading/trailing hyphens.
 * Uses a deterministic fallback if the username becomes empty after sanitization.
 */
export function generateCustomerSlug(
  username?: string | null,
  fallbackId?: string | null
): string {
  let slug = (username ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug || slug.length < 2) {
    const rawFallback = (fallbackId ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "").replace(/-+/g, "");
    slug = rawFallback ? `user-${rawFallback}` : "vps-user";
  }

  // Cap length to 40 characters so instance name (<slug>-<seq>) stays well within LXC 63-char limits
  if (slug.length > 40) {
    slug = slug.slice(0, 40).replace(/-+$/g, "");
  }

  return slug;
}

/**
 * Formats a customer slug and zero-padded sequence into an instance name.
 * Example: "mysticblue1117" + 1 -> "mysticblue1117-01"
 */
export function generateCustomerInstanceName(
  username: string | undefined | null,
  sequence: number,
  fallbackId?: string | null
): string {
  const slug = generateCustomerSlug(username, fallbackId);
  const paddedSeq = String(sequence).padStart(2, "0");
  return `${slug}-${paddedSeq}`;
}

/**
 * Atomically allocates the next per-customer sequence from PostgreSQL
 * and builds the safe instance name.
 */
export async function allocateAndBuildCustomerInstanceName(
  customerId: string,
  username: string | undefined | null,
  fallbackId?: string | null
): Promise<{ instanceName: string; sequence: number; slug: string }> {
  const sequence = await allocateCustomerVpsSequence(customerId);
  const slug = generateCustomerSlug(username, fallbackId);
  const instanceName = `${slug}-${String(sequence).padStart(2, "0")}`;
  return { instanceName, sequence, slug };
}
