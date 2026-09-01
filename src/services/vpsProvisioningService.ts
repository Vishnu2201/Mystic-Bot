import crypto from "node:crypto";

import {
  LxcProvisionResult,
  VpsResourceRequest,
} from "../providers/types";

import {
  provisionOnVpsNode,
} from "./vpsNodeService";

export type AutomaticVpsProvisionRequest = {
  vpsNumber: number;

  containerName?: string;

  hostname?: string;

  ramGb: number;
  vcpu: number;
  storageGb: number;
  staticPrivateIpv4?: string;
  initialPassword?: string;
};

export type AutomaticVpsProvisionResult = {
  containerName: string;

  hostname: string;

  privateIpv4: string | null;

  resources: VpsResourceRequest;

  ramLimitApplied: boolean;
  cpuLimitApplied: boolean;

  storageLimitApplied: boolean;
  storageLimitMessage: string;

  raw: LxcProvisionResult;
};

function defaultHostname(
  vpsNumber: number
): string {
  return `mystic-vps-${String(
    vpsNumber
  ).padStart(6, "0")}`;
}

function requiredConfig(
  name: string
): string {
  const value =
    process.env[name]
      ?.trim();

  if (
    !value
  ) {
    throw new Error(
      `Missing required environment variable: ${name}`
    );
  }

  return value;
}

export function generateSecureInitialPassword(
  length = 24
): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZ" +
    "abcdefghijkmnopqrstuvwxyz" +
    "23456789" +
    "!@#$%^&*-_=+";

  const random =
    crypto.randomBytes(
      length
    );

  let password = "";

  for (
    let index = 0;
    index < length;
    index += 1
  ) {
    password +=
      alphabet[
        random[index] %
          alphabet.length
      ];
  }

  return password;
}

export async function provisionAutomaticVps(
  request: AutomaticVpsProvisionRequest
): Promise<AutomaticVpsProvisionResult> {
  if (
    !Number.isInteger(
      request.vpsNumber
    ) ||
    request.vpsNumber < 1
  ) {
    throw new Error(
      "VPS number must be a positive integer."
    );
  }

  const containerName =
    request.containerName?.trim() ||
    defaultHostname(
      request.vpsNumber
    );

  const hostname =
    request.hostname?.trim() ||
    containerName;

  const result =
    await provisionOnVpsNode({
      vpsNumber:
        request.vpsNumber,

      containerName,

      hostname,

      resources: {
        ramGb:
          request.ramGb,

        vcpu:
          request.vcpu,

        storageGb:
          request.storageGb,
      },

      templateDistribution:
        requiredConfig(
          "VPS_LXC_TEMPLATE_DISTRIBUTION"
        ),

      templateRelease:
        requiredConfig(
          "VPS_LXC_TEMPLATE_RELEASE"
        ),

      templateArchitecture:
        requiredConfig(
          "VPS_LXC_TEMPLATE_ARCHITECTURE"
        ),

      bridgeName:
        requiredConfig(
          "VPS_LXC_BRIDGE"
        ),

      staticPrivateIpv4: request.staticPrivateIpv4,

      initialPassword: request.initialPassword,

      startupTimeoutSeconds:
        Number(
          process.env[
            "VPS_LXC_STARTUP_TIMEOUT_SECONDS"
          ] ?? "90"
        ),
    });

  return {
    containerName:
      result.containerName,

    hostname:
      result.hostname,

    privateIpv4:
      result.privateIpv4,

    resources: {
      ramGb:
        result.requestedRamGb,

      vcpu:
        result.requestedVcpu,

      storageGb:
        result.requestedStorageGb,
    },

    ramLimitApplied:
      result.ramLimitApplied,

    cpuLimitApplied:
      result.cpuLimitApplied,

    storageLimitApplied:
      result.storageLimitApplied,

    storageLimitMessage:
      result.storageLimitMessage,

    raw:
      result,
  };
}