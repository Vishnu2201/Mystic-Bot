import {
  HostCapacity,
  LxcContainerInfo,
  LxcContainerState,
  LxcProvisionRequest,
  LxcProvisionResult,
  VpsProvider,
} from "./types";

import { SshClient } from "./sshClient";

const SAFE_CONTAINER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SAFE_HOSTNAME = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;

function containerNameFor(vpsNumber: number): string {
  if (!Number.isInteger(vpsNumber) || vpsNumber < 1) {
    throw new Error("VPS number must be a positive integer.");
  }
  return `mystic-vps-${String(vpsNumber).padStart(6, "0")}`;
}

function assertSafeContainerName(value: string): void {
  if (!SAFE_CONTAINER_NAME.test(value)) {
    throw new Error(`Unsafe container name: ${value}`);
  }
}

function assertSafeHostname(value: string): void {
  if (!SAFE_HOSTNAME.test(value)) {
    throw new Error(`Unsafe hostname: ${value}`);
  }
}

function bytesFromGb(gb: number): number {
  return Math.floor(gb * 1024 * 1024 * 1024);
}

function parseKeyValueOutput(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    values.set(key, value);
  }
  return values;
}

export class IncusProvider implements VpsProvider {
  private readonly ssh: SshClient;
  private readonly imageAlias: string;
  private readonly storagePool: string;
  private readonly storagePoolType: string;
  private readonly requireHardQuota: boolean;
  private readonly processLimit: string;

  public constructor(ssh: SshClient) {
    this.ssh = ssh;
    this.imageAlias = process.env.VPS_INCUS_IMAGE_ALIAS?.trim() || "images:ubuntu/noble/amd64";
    this.storagePool = process.env.VPS_INCUS_STORAGE_POOL?.trim() || "default";
    this.storagePoolType = process.env.VPS_INCUS_STORAGE_POOL_TYPE?.trim().toLowerCase() || "dir";
    this.requireHardQuota = (process.env.VPS_INCUS_REQUIRE_HARD_QUOTA?.trim() ?? "false") === "true";
    this.processLimit = process.env.VPS_INCUS_LIMIT_PROCESSES?.trim() || "512";
  }

  private async runProvisionStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new Error(
        `Failed during Incus ${stage}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  public getContainerName(vpsNumber: number): string {
    return containerNameFor(vpsNumber);
  }

  public async getHostCapacity(): Promise<HostCapacity> {
    const result = await this.ssh.runChecked(
      [
        "set -eu",
        'TOTAL_MEMORY="$(awk \'/MemTotal/ {print $2 * 1024}\' /proc/meminfo)"',
        'AVAILABLE_MEMORY="$(awk \'/MemAvailable/ {print $2 * 1024}\' /proc/meminfo)"',
        'CPU_COUNT="$(nproc)"',
        'ROOT_AVAILABLE="$(df -B1 / | awk \'NR==2 {print $4}\')"',
        'CONTAINER_COUNT="$(incus list --format csv 2>/dev/null | wc -l | tr -d \' \')"',
        'printf "totalMemoryBytes=%s\\n" "$TOTAL_MEMORY"',
        'printf "availableMemoryBytes=%s\\n" "$AVAILABLE_MEMORY"',
        'printf "cpuCount=%s\\n" "$CPU_COUNT"',
        'printf "rootFilesystemAvailableBytes=%s\\n" "$ROOT_AVAILABLE"',
        'printf "existingContainerCount=%s\\n" "$CONTAINER_COUNT"',
      ].join("\n")
    );

    const values = parseKeyValueOutput(result.stdout);

    return {
      totalMemoryBytes: Number(values.get("totalMemoryBytes") ?? 0),
      availableMemoryBytes: Number(values.get("availableMemoryBytes") ?? 0),
      cpuCount: Number(values.get("cpuCount") ?? 0),
      rootFilesystemAvailableBytes: Number(values.get("rootFilesystemAvailableBytes") ?? 0),
      existingContainerCount: Number(values.get("existingContainerCount") ?? 0),
    };
  }

  public async containerExists(containerName: string): Promise<boolean> {
    assertSafeContainerName(containerName);
    const result = await this.ssh.run(`incus info ${containerName}`);
    return result.exitCode === 0;
  }

  public async getContainerInfo(containerName: string): Promise<LxcContainerInfo> {
    assertSafeContainerName(containerName);

    const result = await this.ssh.run(
      `incus list ${containerName} --format json`
    );

    if (result.exitCode !== 0) {
      return {
        name: containerName,
        state: "UNKNOWN",
        privateIpv4: null,
      };
    }

    try {
      const parsed = JSON.parse(result.stdout) as Array<{
        name: string;
        status: string;
        state?: {
          network?: Record<string, { addresses?: Array<{ family: string; address: string; scope: string }> }>;
        };
      }>;

      const instance = parsed.find((i) => i.name === containerName) || parsed[0];
      if (!instance) {
        return { name: containerName, state: "UNKNOWN", privateIpv4: null };
      }

      const statusUpper = (instance.status || "").toUpperCase();
      const state: LxcContainerState =
        statusUpper === "RUNNING" || statusUpper === "STOPPED" || statusUpper === "FROZEN"
          ? statusUpper
          : "UNKNOWN";

      let privateIpv4: string | null = null;
      if (instance.state?.network) {
        for (const netDevice of Object.values(instance.state.network)) {
          if (netDevice.addresses) {
            for (const addr of netDevice.addresses) {
              if (addr.family === "inet" && addr.scope === "global" && addr.address !== "127.0.0.1") {
                privateIpv4 = addr.address;
                break;
              }
            }
          }
          if (privateIpv4) break;
        }
      }

      return { name: containerName, state, privateIpv4 };
    } catch {
      return { name: containerName, state: "UNKNOWN", privateIpv4: null };
    }
  }

  private async waitForPrivateIpv4(
    containerName: string,
    timeoutSeconds: number
  ): Promise<string> {
    const startedAt = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startedAt < timeoutMs) {
      const info = await this.getContainerInfo(containerName);

      if (info.state === "RUNNING" && info.privateIpv4 && info.privateIpv4 !== "0.0.0.0") {
        return info.privateIpv4;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error(`Timed out waiting for DHCP IPv4 on Incus container ${containerName}.`);
  }

  private validateRequest(request: LxcProvisionRequest): void {
    const containerName = request.containerName?.trim() || containerNameFor(request.vpsNumber);
    assertSafeContainerName(containerName);
    assertSafeHostname(request.hostname);

    if (request.resources.ramGb <= 0 || !Number.isFinite(request.resources.ramGb)) {
      throw new Error("RAM must be greater than zero.");
    }
    if (!Number.isInteger(request.resources.vcpu) || request.resources.vcpu < 1) {
      throw new Error("vCPU must be a positive integer.");
    }
    if (request.resources.storageGb <= 0 || !Number.isFinite(request.resources.storageGb)) {
      throw new Error("Storage must be greater than zero.");
    }

    if (this.requireHardQuota && this.storagePoolType === "dir") {
      throw new Error(
        `Safety Check: Incus storage pool "${this.storagePool}" (type: dir) does not enforce hard per-VPS disk quotas. Set VPS_INCUS_REQUIRE_HARD_QUOTA=false to permit un-enforced provisioning.`
      );
    }
  }

  public async provision(request: LxcProvisionRequest): Promise<LxcProvisionResult> {
    this.validateRequest(request);

    const containerName = request.containerName?.trim() || containerNameFor(request.vpsNumber);

    const alreadyExists = await this.runProvisionStage("container existence check", () =>
      this.containerExists(containerName)
    );

    if (alreadyExists) {
      throw new Error(`Container ${containerName} already exists. Refusing to overwrite it.`);
    }

    const capacity = await this.runProvisionStage("host capacity check", () =>
      this.getHostCapacity()
    );

    const requestedMemoryBytes = bytesFromGb(request.resources.ramGb);

    if (capacity.availableMemoryBytes < requestedMemoryBytes) {
      throw new Error(
        `Insufficient available host memory. Requested ${request.resources.ramGb} GB, available ${(capacity.availableMemoryBytes / 1024 / 1024 / 1024).toFixed(2)} GB.`
      );
    }

    if (capacity.rootFilesystemAvailableBytes < bytesFromGb(request.resources.storageGb)) {
      throw new Error(
        `Insufficient root filesystem capacity for requested ${request.resources.storageGb} GB.`
      );
    }

    let created = false;

    try {
      // 1. Launch unprivileged Incus container with profiles default & mystic-vps
      await this.runProvisionStage("container launch", () =>
        this.ssh.runArgumentsChecked(
          "incus",
          [
            "launch",
            this.imageAlias,
            containerName,
            "-p",
            "default",
            "-p",
            "mystic-vps",
            "-c",
            `limits.memory=${request.resources.ramGb}GiB`,
            "-c",
            `limits.cpu=${request.resources.vcpu}`,
            "-c",
            `limits.processes=${this.processLimit}`,
          ],
          { timeoutMs: 10 * 60 * 1000, pty: true }
        )
      );

      created = true;

      // 2. Set root disk size on existing root device from profile (Do NOT add a second root device)
      await this.runProvisionStage("storage limit configuration", () =>
        this.ssh.runArgumentsChecked("incus", [
          "config",
          "device",
          "set",
          containerName,
          "root",
          "size",
          `${request.resources.storageGb}GiB`,
        ])
      );

      // 3. Inject root password & configure OpenSSH server inside container
      if (request.initialPassword) {
        const encodedPassword = Buffer.from(request.initialPassword, "utf8").toString("base64");
        await this.runProvisionStage("SSH/password setup", () =>
          this.ssh.runChecked(
            [
              "set -eu",
              `incus exec ${containerName} -- sh -lc 'export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y openssh-server; mkdir -p /run/sshd /etc/ssh/sshd_config.d; printf "PermitRootLogin yes\\nPasswordAuthentication yes\\n" > /etc/ssh/sshd_config.d/99-mystic.conf; grep -q "^Include /etc/ssh/sshd_config.d/\\*.conf" /etc/ssh/sshd_config || printf "\\nInclude /etc/ssh/sshd_config.d/*.conf\\n" >> /etc/ssh/sshd_config; sshd -t; systemctl enable ssh || true; systemctl restart ssh || service ssh restart || true; echo root:$(printf %s ${encodedPassword} | base64 -d) | chpasswd'`,
            ].join("\n")
          )
        );
      }

      // 4. Discover assigned IPv4 address on incusbr0
      const discoveredIp = await this.runProvisionStage("network/DHCP discovery", () =>
        this.waitForPrivateIpv4(containerName, request.startupTimeoutSeconds ?? 90)
      );

      const privateIpv4 = request.staticPrivateIpv4 || discoveredIp;

      const finalInfo = await this.runProvisionStage("final verification", () =>
        this.getContainerInfo(containerName)
      );

      if (finalInfo.state !== "RUNNING") {
        throw new Error(
          `Incus container ${containerName} did not remain RUNNING. Current state: ${finalInfo.state}`
        );
      }

      const storageEnforced = this.storagePoolType !== "dir";
      const storageMessage = storageEnforced
        ? `Storage limit of ${request.resources.storageGb} GiB is strictly enforced by Incus pool "${this.storagePool}" (${this.storagePoolType}).`
        : `Storage quota of ${request.resources.storageGb} GiB is set on container device, but directory-backed pool "${this.storagePool}" does not enforce hard per-container disk limits.`;

      return {
        containerName,
        hostname: request.hostname,
        state: finalInfo.state,
        privateIpv4,
        requestedRamGb: request.resources.ramGb,
        requestedVcpu: request.resources.vcpu,
        requestedStorageGb: request.resources.storageGb,
        ramLimitApplied: true,
        cpuLimitApplied: true,
        storageLimitApplied: true,
        storageLimitEnforced: storageEnforced,
        storageBackend: this.storagePoolType,
        storageStatus: storageEnforced ? "enforced_quota" : "unbounded_directory",
        storageLimitMessage: storageMessage,
        createdAt: new Date(),
      };
    } catch (error) {
      if (created) {
        try {
          await this.ssh.runArguments("incus", ["delete", containerName, "--force"], {
            timeoutMs: 60_000,
          });
          console.warn(`⚠️ Rolled back newly created Incus container ${containerName}.`);
        } catch (rollbackError) {
          console.error(
            `❌ Failed to roll back Incus container ${containerName}:`,
            rollbackError
          );
        }
      }
      throw error;
    }
  }

  public async start(containerName: string): Promise<LxcContainerInfo> {
    assertSafeContainerName(containerName);
    await this.ssh.runArgumentsChecked("incus", ["start", containerName]);
    const info = await this.getContainerInfo(containerName);
    if (info.state !== "RUNNING") {
      throw new Error(`Failed to start ${containerName}. Current state: ${info.state}`);
    }
    return info;
  }

  public async stop(containerName: string): Promise<LxcContainerInfo> {
    assertSafeContainerName(containerName);
    await this.ssh.runArgumentsChecked("incus", ["stop", containerName]);
    const info = await this.getContainerInfo(containerName);
    if (info.state !== "STOPPED") {
      throw new Error(`Failed to stop ${containerName}. Current state: ${info.state}`);
    }
    return info;
  }

  public async restart(containerName: string): Promise<LxcContainerInfo> {
    assertSafeContainerName(containerName);
    await this.ssh.runArgumentsChecked("incus", ["restart", containerName]);
    const info = await this.getContainerInfo(containerName);
    if (info.state !== "RUNNING") {
      throw new Error(`Failed to restart ${containerName}. Current state: ${info.state}`);
    }
    return info;
  }

  public async destroy(containerName: string): Promise<void> {
    assertSafeContainerName(containerName);
    await this.ssh.runArgumentsChecked("incus", ["delete", containerName, "--force"], {
      timeoutMs: 60_000,
    });
  }

  public async runInContainer(
    containerName: string,
    command: string,
    timeoutMs = 120_000
  ): Promise<string> {
    assertSafeContainerName(containerName);
    const encoded = Buffer.from(command, "utf8").toString("base64");
    const result = await this.ssh.run(
      `incus exec ${containerName} -- sh -lc "printf %s '${encoded}' | base64 -d | sh"`,
      { timeoutMs }
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `Incus container command failed for ${containerName}: ${result.stderr || result.stdout}`
      );
    }

    return result.stdout;
  }
}
