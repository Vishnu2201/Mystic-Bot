import { SshClient } from "./sshClient";

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

function ipToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255 || String(n) !== part) return null;
    num = (num << 8) + n;
  }
  return num >>> 0;
}

function isIpInSubnet(ip: string, subnetCidr: string): boolean {
  const [subnetIp, maskBitsStr] = subnetCidr.split("/");
  const maskBits = maskBitsStr ? parseInt(maskBitsStr, 10) : 24;

  const ipNum = ipToLong(ip);
  const subnetNum = ipToLong(subnetIp);

  if (ipNum === null || subnetNum === null) return false;
  if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) return false;

  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipNum & mask) === (subnetNum & mask);
}

export class PublicSshGatewayProvider {
  private readonly ssh: SshClient;
  public readonly defaultPublicHost: string;
  public readonly defaultTargetPort: number;
  public readonly portStart: number;
  public readonly portEnd: number;
  public readonly masqueradeSubnet: string;
  public readonly enabled: boolean;

  public readonly natChain = "MYSTIC-VPS-SSH";
  public readonly fwdChain = "MYSTIC-VPS-SSH-FWD";
  public readonly masqChain = "MYSTIC-VPS-SSH-MASQ";

  public constructor(ssh: SshClient) {
    this.ssh = ssh;
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
    this.masqueradeSubnet =
      process.env.PUBLIC_SSH_MASQUERADE_SUBNET?.trim() || "10.170.92.0/24";
    this.enabled =
      (process.env.PUBLIC_SSH_GATEWAY_ENABLED?.trim() ?? "true") === "true";
  }

  private async runIptables(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      return await this.ssh.runArguments(
        "sudo",
        ["-n", "/usr/local/sbin/mystic-vps-gateway", ...args]
      );
    } catch (err: any) {
      return {
        stdout: "",
        stderr: err.message || "Remote execution error",
        exitCode: 1,
      };
    }
  }

  public isTargetIpValid(targetHost: string): boolean {
    if (!targetHost) return false;
    const cleanHost = targetHost.split("/")[0].trim();
    return isIpInSubnet(cleanHost, this.masqueradeSubnet);
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

      // Ensure MASQUERADE for configured subnet inside masqChain
      const checkMasqRule = await this.runIptables([
        "-t",
        "nat",
        "-C",
        this.masqChain,
        "-d",
        this.masqueradeSubnet,
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
          this.masqueradeSubnet,
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

    if (!this.isTargetIpValid(targetHost)) {
      throw new Error(
        `Invalid target IPv4 address for VPS: ${targetHostInput}. Must be within subnet ${this.masqueradeSubnet}.`
      );
    }

    await this.initChains();

    const actual = await this.listActualMappings();
    const existing = actual.find((m) => m.publicPort === publicPort);

    if (existing) {
      if (
        existing.targetHost === targetHost &&
        existing.targetPort === targetPort
      ) {
        return true;
      }

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
      return true;
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

    if (!this.isTargetIpValid(targetHost)) {
      return {
        verified: false,
        status: "configured",
        message: `Target IP ${targetHost} is outside allowed subnet ${this.masqueradeSubnet}.`,
      };
    }

    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const testCommand = `timeout ${timeoutSec} bash -c 'cat < /dev/null > /dev/tcp/${targetHost}/${targetPort}' 2>/dev/null || nc -z -w ${timeoutSec} ${targetHost} ${targetPort} 2>/dev/null`;

    try {
      const result = await this.ssh.run(testCommand, { timeoutMs: timeoutMs + 2000 });
      if (result.exitCode === 0) {
        return {
          verified: true,
          status: "verified",
          message: `Target VPS SSH ${targetHost}:${targetPort} verified reachable via TCP on host.`,
          lastVerifiedAt: new Date(),
        };
      } else {
        return {
          verified: false,
          status: "configured",
          message: `Target VPS SSH ${targetHost}:${targetPort} TCP connection timed out or refused on host.`,
        };
      }
    } catch (err: any) {
      return {
        verified: false,
        status: "configured",
        message: `Target VPS SSH ${targetHost}:${targetPort} connectivity check failed: ${err.message}`,
      };
    }
  }

  public async checkGatewayHealth(): Promise<GatewayHealthResult> {
    if (!this.enabled) {
      return {
        iptablesAvailable: false,
        chainsExist: false,
        isForwardingEnabled: false,
        activeRulesCount: 0,
        message: "Public SSH gateway is disabled.",
      };
    }

    const testIptables = await this.runIptables(["-L", "-n"]);
    const iptablesAvailable = testIptables.exitCode === 0;

    if (!iptablesAvailable) {
      return {
        iptablesAvailable: false,
        chainsExist: false,
        isForwardingEnabled: false,
        activeRulesCount: 0,
        message: `iptables helper is not available via sudo on remote host (${testIptables.stderr.trim() || "exit code " + testIptables.exitCode}).`,
      };
    }

    const mappings = await this.listActualMappings();

    return {
      iptablesAvailable: true,
      chainsExist: true,
      isForwardingEnabled: true,
      activeRulesCount: mappings.length,
      message: `iptables active on remote host with ${mappings.length} DNAT rule(s) in ${this.natChain}.`,
    };
  }
}
