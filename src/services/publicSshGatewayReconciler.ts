import { PublicSshGatewayProvider } from "../providers/publicSshGatewayProvider";
import {
  listVpsInstances,
  updateVpsProvisioningDetails,
  VpsInstanceRecord,
} from "./vpsDatabase";

const gatewayProvider = new PublicSshGatewayProvider();
let isReconciling = false;
let reconcilerTimer: NodeJS.Timeout | null = null;

export interface ReconciliationSummary {
  vpsChecked: number;
  addedOrUpdated: number;
  staleRemoved: number;
  errors: number;
  durationMs: number;
}

export async function reconcilePublicSshGateway(): Promise<ReconciliationSummary> {
  if (isReconciling) {
    console.log("[Gateway Reconciler] Reconciliation already in progress. Skipping overlapping run.");
    return { vpsChecked: 0, addedOrUpdated: 0, staleRemoved: 0, errors: 0, durationMs: 0 };
  }

  isReconciling = true;
  const startTime = Date.now();
  let addedOrUpdated = 0;
  let staleRemoved = 0;
  let errors = 0;

  try {
    const allVps = await listVpsInstances();

    // 1. Desired state: active VPS instances requiring public SSH
    const activeVpsList = allVps.filter(
      (vps) =>
        (vps.status === "active" || vps.status === "running") &&
        vps.publicSshPort !== undefined &&
        vps.publicSshPort !== null &&
        vps.privateIpv4 !== undefined &&
        vps.privateIpv4 !== null
    );

    const desiredPortMap = new Map<number, VpsInstanceRecord>();
    for (const vps of activeVpsList) {
      desiredPortMap.set(Number(vps.publicSshPort), vps);
    }

    // 2. Initialize firewall chains
    await gatewayProvider.initChains();

    // 3. Reconcile desired rules (Add / Update)
    for (const [publicPort, vps] of desiredPortMap.entries()) {
      try {
        const targetHost = vps.privateIpv4!;
        const targetPort = vps.publicSshTargetPort ?? 22;

        const success = await gatewayProvider.ensureMapping(
          publicPort,
          targetHost,
          targetPort
        );

        if (success) {
          // Verify target SSH TCP connectivity
          const verification = await gatewayProvider.verifyTargetConnectivity(
            targetHost,
            targetPort
          );

          await updateVpsProvisioningDetails({
            id: vps.id,
            providerInstanceId: vps.providerInstanceId,
            hostname: vps.hostname,
            privateIpv4: vps.privateIpv4,
            sshUsername: vps.sshUsername || "root",
            sshPort: vps.sshPort || 22,
            publicSshHost: vps.publicSshHost || gatewayProvider.defaultPublicHost,
            publicSshPort: publicPort,
            publicSshTargetHost: targetHost,
            publicSshTargetPort: targetPort,
            publicSshStatus: verification.status,
            publicSshLastVerifiedAt: verification.lastVerifiedAt ?? new Date(),
          });

          addedOrUpdated++;
        } else {
          errors++;
        }
      } catch (vpsErr) {
        console.error(`[Gateway Reconciler] Failed reconciliation for VPS #${vps.vpsNumber}:`, vpsErr);
        errors++;
      }
    }

    // 4. Stale rule cleanup (Remove rules for deleted / expired VPS)
    const actualMappings = await gatewayProvider.listActualMappings();

    for (const actual of actualMappings) {
      if (!desiredPortMap.has(actual.publicPort)) {
        console.log(
          `[Gateway Reconciler] Removing stale gateway rule: port ${actual.publicPort} -> ${actual.targetHost}:${actual.targetPort}`
        );
        const removed = await gatewayProvider.removeMapping(actual.publicPort);
        if (removed) staleRemoved++;
      }
    }

    // 5. Explicitly handle expired VPS instances (ensure gateway rule removed & status updated)
    const expiredVpsList = allVps.filter(
      (vps) => vps.status === "expired" && vps.publicSshPort
    );

    for (const expiredVps of expiredVpsList) {
      const port = Number(expiredVps.publicSshPort);
      await gatewayProvider.removeMapping(port);

      if (expiredVps.publicSshStatus !== "disabled") {
        await updateVpsProvisioningDetails({
          id: expiredVps.id,
          providerInstanceId: expiredVps.providerInstanceId,
          hostname: expiredVps.hostname,
          sshUsername: expiredVps.sshUsername || "root",
          sshPort: expiredVps.sshPort || 22,
          publicSshStatus: "disabled",
        });
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[Gateway Reconciler] Completed in ${durationMs}ms. Active: ${activeVpsList.length}, Reconciled: ${addedOrUpdated}, Stale Removed: ${staleRemoved}, Errors: ${errors}`
    );

    return {
      vpsChecked: activeVpsList.length,
      addedOrUpdated,
      staleRemoved,
      errors,
      durationMs,
    };
  } catch (err) {
    console.error("[Gateway Reconciler] Critical failure during reconciliation:", err);
    return {
      vpsChecked: 0,
      addedOrUpdated,
      staleRemoved,
      errors: errors + 1,
      durationMs: Date.now() - startTime,
    };
  } finally {
    isReconciling = false;
  }
}

export function startPublicSshGatewayReconciler(
  intervalMs = Number(process.env.PUBLIC_SSH_RECONCILE_INTERVAL_MS || "300000")
): void {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
  }

  // Initial execution on startup
  reconcilePublicSshGateway().catch((err) =>
    console.error("[Gateway Reconciler] Initial startup reconciliation error:", err)
  );

  // Set recurring timer
  reconcilerTimer = setInterval(() => {
    reconcilePublicSshGateway().catch((err) =>
      console.error("[Gateway Reconciler] Interval reconciliation error:", err)
    );
  }, intervalMs);

  console.log(`[Gateway Reconciler] Background service started (Interval: ${intervalMs / 1000}s).`);
}

export async function getGatewayDiagnostics(vpsNumber?: number): Promise<{
  health: any;
  mappings: any[];
  vpsDiagnostic?: any;
}> {
  const health = await gatewayProvider.checkGatewayHealth();
  const mappings = await gatewayProvider.listActualMappings();

  let vpsDiagnostic: any = undefined;

  if (vpsNumber) {
    const allVps = await listVpsInstances();
    const vps = allVps.find((v) => v.vpsNumber === vpsNumber);

    if (vps) {
      const port = vps.publicSshPort ? Number(vps.publicSshPort) : undefined;
      const actualRule = port ? mappings.find((m) => m.publicPort === port) : undefined;
      let tcpVerification: any = undefined;

      if (vps.privateIpv4) {
        tcpVerification = await gatewayProvider.verifyTargetConnectivity(vps.privateIpv4);
      }

      vpsDiagnostic = {
        vpsNumber: vps.vpsNumber,
        status: vps.status,
        publicHost: vps.publicSshHost || gatewayProvider.defaultPublicHost,
        publicPort: port ?? "N/A",
        targetHost: vps.privateIpv4 ?? "Not assigned",
        targetPort: vps.publicSshTargetPort ?? 22,
        publicSshStatus: vps.publicSshStatus || "unverified",
        lastVerifiedAt: vps.publicSshLastVerifiedAt,
        natRulePresent: Boolean(actualRule),
        actualRule,
        tcpReachable: tcpVerification?.verified ?? false,
        tcpMessage: tcpVerification?.message ?? "N/A",
      };
    }
  }

  return { health, mappings, vpsDiagnostic };
}
