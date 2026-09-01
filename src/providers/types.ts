export type SshConnectionConfig = {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  readyTimeoutMs?: number;
};

export type RemoteCommandResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type VpsResourceRequest = {
  ramGb: number;
  vcpu: number;
  storageGb: number;
};

export type LxcProvisionRequest = {
  vpsNumber: number;

  containerName?: string;

  hostname: string;

  resources: VpsResourceRequest;

  templateDistribution: string;
  templateRelease: string;
  templateArchitecture: string;

  bridgeName: string;

  staticPrivateIpv4?: string;

  startupTimeoutSeconds?: number;

  initialPassword?: string;
};

export type LxcContainerState =
  | "RUNNING"
  | "STOPPED"
  | "FROZEN"
  | "UNKNOWN";

export type LxcContainerInfo = {
  name: string;
  state: LxcContainerState;
  privateIpv4: string | null;
};

export type LxcProvisionResult = {
  containerName: string;

  hostname: string;

  state: LxcContainerState;

  privateIpv4: string | null;

  requestedRamGb: number;
  requestedVcpu: number;
  requestedStorageGb: number;

  ramLimitApplied: boolean;
  cpuLimitApplied: boolean;

  storageLimitApplied: boolean;
  storageLimitEnforced: boolean;
  storageBackend: string;
  storageStatus: string;
  storageLimitMessage: string;

  createdAt: Date;
};

export type HostCapacity = {
  totalMemoryBytes: number;
  availableMemoryBytes: number;

  cpuCount: number;

  rootFilesystemAvailableBytes: number;

  existingContainerCount: number;
};