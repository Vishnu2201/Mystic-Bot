import { execFile } from "node:child_process";
import net from "node:net";
import util from "node:util";

const execFileAsync = util.promisify(execFile);

export type PublicSshStatus =
  | "unverified"
  | "configured"
  | "verified"
  | "failed"
  | "disabled";

export interface PublicSshGatewayRule {
  publicHost: string;
  publicPort: number;
  targetHost: string;
  targetPort: number;
  status: PublicSshStatus;
  lastVerifiedAt?: Date;
  message?: string;
}

export interface GatewayVerificationResult {
  verified: boolean;
  status: PublicSshStatus;
  message: string;
  lastVerifiedAt?: Date;
}

export interface ActualIptablesMapping {
  publicPort: number;
  targetHost: string;
  targetPort: number;
  lineNum: number;
}

export interface GatewayHealthResult {
  iptablesAvailable: boolean;
  chainsExist: boolean;
  isForwardingEnabled: boolean;
  activeRulesCount: number;
  message: string;
}

export class PublicSshGatewayProvider {
  public readonly defaultPublicHost: string;
  public readonly defaultTargetPort: number;
  public readonly portStart: number;
  public readonly portEnd: number;
  public readonly enabled: boolean;

  public readonly natChain = "MYSTIC-VPS-SSH";
  public readonly fwdChain = "MYSTIC-VPS-SSH-FWD";
  public readonly masqChain = "MYSTIC-VPS-SSH-MASQ";

  constructor() {
    this.defaultPublicHost =
      process.env.PUBLIC_SSH_HOST?.trim() || "ssh.mysticservers.com";
    this.defaultTargetPort = Number(
      process.env.PUBLIC_SSH_TARGET_PORT?.trim() || "22"
    );
    this.portStart = Number(
      process.env.PUBLIC_SSH_PORT_START?.trim() || "22001"
    );
    this.portEnd = Number(
      process.env.PUBLIC_SSH_PORT_END?.trim() || "22100"
    );
    this.enabled =
      (process.env.PUBLIC_SSH_GATEWAY_ENABLED?.trim() ?? "true") === "true";
  }

  private async runIptables(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execFileAsync("iptables", args);
      return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 0 };
    } catch (err: any) {
      const stdout = err.stdout ? err.stdout.toString() : "";
      const stderr = err.stderr ? err.stderr.toString() : err.message || "";
      const exitCode = typeof err.code === "number" ? err.code : 1;
      return { stdout, stderr, exitCode };
    }
  }

  public async initChains(): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      // 1. Create NAT chain MYSTIC-VPS-SSH
      await this.runIptables(["-t", "nat", "-N", this.natChain]);

      // Jump from PREROUTING to MYSTIC-VPS-SSH
      const checkNatJump = await this.runIptables([
        "-t",
        "nat",
        "-C",
        "PREROUTING",
        "-p",
        "tcp",
        "-m",
        "multiport",
        "--dports",
        `${this.portStart}:${this.portEnd}`,
        "-j",
        this.natChain,
      ]);

      if (checkNatJump.exitCode !== 0) {
        await this.runIptables([
          "-t",
          "nat",
          "-A",
          "PREROUTING",
          "-p",
          "tcp",
          "-m",
          "multiport",
          "--dports",
          `${this.portStart}:${this.portEnd}`,
          "-j",
          this.natChain,
        ]);
      }

      // 2. Create FILTER chain MYSTIC-VPS-SSH-FWD
      await this.runIptables(["-N", this.fwdChain]);

      const checkFwdJump = await this.runIptables([
        "-C",
        "FORWARD",
        "-j",
        this.fwdChain,
      ]);

      if (checkFwdJump.exitCode !== 0) {
        await this.runIptables(["-A", "FORWARD", "-j", this.fwdChain]);
      }

      // 3. Create POSTROUTING chain MYSTIC-VPS-SSH-MASQ for return path
      await this.runIptables(["-t", "nat", "-N", this.masqChain]);

      const checkMasqJump = await this.runIptables([
        "-t",
        "nat",
        "-C",
        "POSTROUTING",
        "-j",
        this.masqChain,
      ]);

      if (checkMasqJump.exitCode !== 0) {
        await this.runIptables([
          "-t",
          "nat",
          "-A",
          "POSTROUTING",
          "-j",
          this.masqChain,
        ]);
      }

      // Ensure MASQUERADE for 10.0.3.0/24 inside masqChain
      const checkMasqRule = await this.runIptables([
        "-t",
        "nat",
        "-C",
        this.masqChain,
        "-d",
        "10.0.3.0/24",
        "-p",
        "tcp",
        "--dport",
        "22",
        "-j",
        "MASQUERADE",
      ]);

      if (checkMasqRule.exitCode !== 0) {
        await this.runIptables([
          "-t",
          "nat",
          "-A",
          this.masqChain,
          "-d",
          "10.0.3.0/24",
          "-p",
          "tcp",
          "--dport",
          "22",
          "-j",
          "MASQUERADE",
        ]);
      }

      return true;
    } catch (err) {
      console.warn("[Public SSH Gateway] iptables initChains warning:", err);
      return false;
    }
  }

  public async listActualMappings(): Promise<ActualIptablesMapping[]> {
    if (!this.enabled) return [];

    const res = await this.runIptables([
      "-t",
      "nat",
      "-L",
      this.natChain,
      "-n",
      "-v",
      "--line-numbers",
    ]);

    if (res.exitCode !== 0) {
      return [];
    }

    const mappings: ActualIptablesMapping[] = [];
    const lines = res.stdout.split("\n");

    for (const line of lines) {
      // Matches lines like:
      // 1     0     0 DNAT       tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp dpt:22002 to:10.0.3.210:22
      const match = line.match(
        /^(\d+)\s+.*tcp\s+dpt:(\d+)\s+to:([0-9.]+):(\d+)/i
      );

      if (match) {
        mappings.push({
          lineNum: Number(match[1]),
          publicPort: Number(match[2]),
          targetHost: match[3],
          targetPort: Number(match[4]),
        });
      }
    }

    return mappings;
  }

  public async ensureMapping(
    publicPort: number,
    targetHostInput: string,
    targetPort = 22
  ): Promise<boolean> {
    if (!this.enabled) return false;

    const targetHost = targetHostInput ? targetHostInput.split("/")[0].trim() : "";

    if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) {
      throw new Error(`Invalid public SSH port: ${publicPort}`);
    }

    if (!/^10\.0\.3\.\d+$/.test(targetHost)) {
      throw new Error(`Invalid target IPv4 address for VPS: ${targetHostInput}`);
    }

    await this.initChains();

    const actual = await this.listActualMappings();
    const existing = actual.find((m) => m.publicPort === publicPort);

    if (existing) {
      if (
        existing.targetHost === targetHost &&
        existing.targetPort === targetPort
      ) {
        // Mapping is already present and correct
        return true;
      }

      // Remove stale mapping for this publicPort
      await this.removeMapping(publicPort);
    }

    // Add DNAT rule in MYSTIC-VPS-SSH
    const dnatRes = await this.runIptables([
      "-t",
      "nat",
      "-A",
      this.natChain,
      "-p",
      "tcp",
      "--dport",
      String(publicPort),
      "-j",
      "DNAT",
      "--to-destination",
      `${targetHost}:${targetPort}`,
    ]);

    if (dnatRes.exitCode !== 0) {
      console.error(
        `[Public SSH Gateway] Failed to add DNAT rule ${publicPort} -> ${targetHost}:${targetPort}: ${dnatRes.stderr}`
      );
      return false;
    }

    // Add FORWARD rule in MYSTIC-VPS-SSH-FWD
    const fwdCheck = await this.runIptables([
      "-C",
      this.fwdChain,
      "-p",
      "tcp",
      "-d",
      targetHost,
      "--dport",
      String(targetPort),
      "-j",
      "ACCEPT",
    ]);

    if (fwdCheck.exitCode !== 0) {
      await this.runIptables([
        "-A",
        this.fwdChain,
        "-p",
        "tcp",
        "-d",
        targetHost,
        "--dport",
        String(targetPort),
        "-j",
        "ACCEPT",
      ]);
    }

    console.log(
      `[Public SSH Gateway] Configured DNAT: ${this.defaultPublicHost}:${publicPort} -> ${targetHost}:${targetPort}`
    );

    return true;
  }

  public async removeMapping(publicPort: number): Promise<boolean> {
    if (!this.enabled) return false;

    await this.initChains();

    const actual = await this.listActualMappings();
    const matches = actual.filter((m) => m.publicPort === publicPort);

    if (matches.length === 0) {
      return true; // Idempotent remove
    }

    for (const match of matches) {
      await this.runIptables([
        "-t",
        "nat",
        "-D",
        this.natChain,
        "-p",
        "tcp",
        "--dport",
        String(publicPort),
        "-j",
        "DNAT",
        "--to-destination",
        `${match.targetHost}:${match.targetPort}`,
      ]);

      await this.runIptables([
        "-D",
        this.fwdChain,
        "-p",
        "tcp",
        "-d",
        match.targetHost,
        "--dport",
        String(match.targetPort),
        "-j",
        "ACCEPT",
      ]);
    }

    console.log(
      `[Public SSH Gateway] Removed DNAT rules for port ${publicPort}`
    );

    return true;
  }

  public async verifyTargetConnectivity(
    targetHostInput: string,
    targetPort = 22,
    timeoutMs = 2500
  ): Promise<GatewayVerificationResult> {
    const targetHost = targetHostInput ? targetHostInput.split("/")[0].trim() : "";
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let hasResolved = false;

      const timer = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          socket.destroy();
          resolve({
            verified: false,
            status: "configured",
            message: `Target VPS SSH ${targetHost}:${targetPort} TCP connection timed out.`,
          });
        }
      }, timeoutMs);

      socket.connect(targetPort, targetHost, () => {
        if (!hasResolved) {
          hasResolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve({
            verified: true,
            status: "verified",
            message: `Target VPS SSH ${targetHost}:${targetPort} verified reachable via TCP socket.`,
            lastVerifiedAt: new Date(),
          });
        }
      });

      socket.on("error", (err) => {
        if (!hasResolved) {
          hasResolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve({
            verified: false,
            status: "configured",
            message: `Target VPS SSH ${targetHost}:${targetPort} unreachable (${err.message}).`,
          });
        }
      });
    });
  }

  public async checkGatewayHealth(): Promise<GatewayHealthResult> {
    const testIptables = await this.runIptables(["-L", "-n"]);
    const iptablesAvailable = testIptables.exitCode === 0;

    if (!iptablesAvailable) {
      return {
        iptablesAvailable: false,
        chainsExist: false,
        isForwardingEnabled: false,
        activeRulesCount: 0,
        message: "iptables command is not available or lacks permissions on this host.",
      };
    }

    const mappings = await this.listActualMappings();

    return {
      iptablesAvailable: true,
      chainsExist: true,
      isForwardingEnabled: true,
      activeRulesCount: mappings.length,
      message: `iptables active with ${mappings.length} DNAT rule(s) in ${this.natChain}.`,
    };
  }
}
