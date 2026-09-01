import path from "node:path";

import {
  LxcProvider,
} from "../providers/lxcProvider";

import {
  SshClient,
} from "../providers/sshClient";

import {
  HostCapacity,
  LxcContainerInfo,
  LxcProvisionRequest,
  LxcProvisionResult,
} from "../providers/types";

function requiredEnvironment(
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

function numberEnvironment(
  name: string,
  fallback: number
): number {
  const raw =
    process.env[name]
      ?.trim();

  if (
    !raw
  ) {
    return fallback;
  }

  const value =
    Number(raw);

  if (
    !Number.isFinite(
      value
    ) ||
    value <= 0
  ) {
    throw new Error(
      `Environment variable ${name} must be a positive number.`
    );
  }

  return value;
}

export function createVpsNodeProvider(): LxcProvider {
  const host =
    requiredEnvironment(
      "VPS_NODE_HOST"
    );

  const username =
    requiredEnvironment(
      "VPS_NODE_SSH_USER"
    );

  const privateKeyPath =
    requiredEnvironment(
      "VPS_NODE_SSH_KEY_PATH"
    );

  const port =
    numberEnvironment(
      "VPS_NODE_SSH_PORT",
      22
    );

  const resolvedKeyPath =
    path.resolve(
      privateKeyPath
    );

  const ssh =
    new SshClient({
      host,
      port,
      username,
      privateKeyPath:
        resolvedKeyPath,

      readyTimeoutMs:
        20_000,
    });

  return new LxcProvider(
    ssh
  );
}

export async function getVpsNodeCapacity(): Promise<HostCapacity> {
  const provider =
    createVpsNodeProvider();

  return provider.getHostCapacity();
}

export async function getVpsNodeContainer(
  containerName: string
): Promise<LxcContainerInfo> {
  const provider =
    createVpsNodeProvider();

  return provider.getContainerInfo(
    containerName
  );
}

export async function provisionOnVpsNode(
  request: LxcProvisionRequest
): Promise<LxcProvisionResult> {
  const provider =
    createVpsNodeProvider();

  return provider.provision(
    request
  );
}

export async function runCommandInVpsContainer(
  containerName: string,
  command: string,
  timeoutMs?: number
): Promise<string> {
  const provider = createVpsNodeProvider();
  return provider.runInContainer(containerName, command, timeoutMs);
}

export async function destroyVpsNodeContainer(
  containerName: string
): Promise<void> {
  const provider = createVpsNodeProvider();
  return provider.destroy(containerName);
}
