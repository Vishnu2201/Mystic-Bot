export interface PterodactylUser {
  id: number;
  external_id: string | null;
  uuid: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  created_at: string;
  updated_at: string;
}

export interface PterodactylAllocation {
  id: number;
  ip: string;
  alias: string | null;
  port: number;
  notes: string | null;
  assigned: boolean;
}

export interface PterodactylServer {
  id: number;
  external_id: string | null;
  uuid: string;
  identifier: string;
  name: string;
  user: number;
  node: number;
  allocation: number;
  status: string | null;
}

export interface CreatePterodactylUserInput {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
}

export interface CreatePterodactylServerInput {
  name: string;
  userId: number;
  ramMb: number;
  cpuLimit: number;
  storageMb: number;
  allocationId: number;
  eggId?: number;
  nestId?: number;
  dockerImage?: string;
  startupCommand?: string;
  environment?: Record<string, string>;
}

export class PterodactylProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultNodeId: number;
  private readonly defaultAllocationIp: string;
  private readonly defaultNestId: number;
  private readonly defaultEggId: number;

  constructor() {
    const rawUrl = process.env.PTERODACTYL_URL?.trim() || "https://panel.mysticservers.com";
    this.baseUrl = rawUrl.replace(/\/+$/, "");

    const token = process.env.PTERODACTYL_API_TOKEN?.trim();
    this.apiKey = token || "";

    this.defaultNodeId = Number(process.env.PTERODACTYL_NODE_ID || 1);
    this.defaultAllocationIp = process.env.PTERODACTYL_ALLOCATION_IP?.trim() || "100.103.138.118";
    this.defaultNestId = Number(process.env.PTERODACTYL_MINECRAFT_NEST_ID || 1);
    this.defaultEggId = Number(process.env.PTERODACTYL_MINECRAFT_EGG_ID || 1);
  }

  private get headers(): Record<string, string> {
    if (!this.apiKey) {
      throw new Error("Missing PTERODACTYL_API_TOKEN in environment configuration.");
    }
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "Application/vnd.pterodactyl.v1+json",
    };
  }

  private async handleResponseError(action: string, response: Response): Promise<never> {
    const status = response.status;
    const body = await response.text().catch(() => "");

    if (status === 401 || status === 403) {
      throw new Error(
        `Pterodactyl API authorization failed (${status}). Verify that PTERODACTYL_API_TOKEN is an Application API key with permission to manage users, allocations, and servers.`
      );
    }

    throw new Error(`Pterodactyl ${action} failed (${status}): ${body}`);
  }

  /**
   * Finds a user on Pterodactyl panel by email address.
   */
  public async findUserByEmail(email: string): Promise<PterodactylUser | null> {
    const url = `${this.baseUrl}/api/application/users?filter[email]=${encodeURIComponent(email)}`;
    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      await this.handleResponseError("user search by email", response);
    }

    const data = (await response.json()) as { data: Array<{ attributes: PterodactylUser }> };
    if (!data.data || data.data.length === 0) {
      return null;
    }

    return data.data[0].attributes;
  }

  /**
   * Finds a user on Pterodactyl panel by username.
   */
  public async findUserByUsername(username: string): Promise<PterodactylUser | null> {
    const url = `${this.baseUrl}/api/application/users?filter[username]=${encodeURIComponent(username)}`;
    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      await this.handleResponseError("user search by username", response);
    }

    const data = (await response.json()) as { data: Array<{ attributes: PterodactylUser }> };
    if (!data.data || data.data.length === 0) {
      return null;
    }

    return data.data[0].attributes;
  }

  /**
   * Creates a new user on Pterodactyl panel.
   */
  public async createUser(input: CreatePterodactylUserInput): Promise<PterodactylUser> {
    const url = `${this.baseUrl}/api/application/users`;
    const payload = {
      username: input.username,
      email: input.email,
      first_name: input.firstName || input.username,
      last_name: input.lastName || "Customer",
      password: input.password,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await this.handleResponseError("user creation", response);
    }

    const data = (await response.json()) as { attributes: PterodactylUser };
    return data.attributes;
  }

  /**
   * Fetches user details by user ID from Pterodactyl panel.
   */
  public async getUser(userId: number): Promise<PterodactylUser | null> {
    const url = `${this.baseUrl}/api/application/users/${userId}`;
    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      if (response.status === 404) return null;
      await this.handleResponseError("getUser", response);
    }

    const data = (await response.json()) as { attributes: PterodactylUser };
    return data.attributes;
  }

  /**
   * Fetches all allocations for a given Pterodactyl node (with pagination support).
   */
  public async listAllocations(nodeId?: number): Promise<PterodactylAllocation[]> {
    const targetNode = nodeId || this.defaultNodeId;
    let page = 1;
    let totalPages = 1;
    const allAllocations: PterodactylAllocation[] = [];

    do {
      const url = `${this.baseUrl}/api/application/nodes/${targetNode}/allocations?per_page=100&page=${page}`;
      const response = await fetch(url, { headers: this.headers });

      if (!response.ok) {
        await this.handleResponseError("allocation list", response);
      }

      const data = (await response.json()) as {
        data: Array<{ attributes: PterodactylAllocation }>;
        meta?: { pagination?: { total_pages?: number } };
      };

      const fetched = (data.data || []).map((item) => item.attributes);
      allAllocations.push(...fetched);

      totalPages = data.meta?.pagination?.total_pages || 1;
      page += 1;
    } while (page <= totalPages);

    return allAllocations;
  }

  /**
   * Dynamically finds the first unassigned allocation on the node matching the target IP.
   */
  public async findAvailableAllocation(nodeId?: number, targetIp?: string): Promise<PterodactylAllocation> {
    const targetNode = nodeId || this.defaultNodeId;
    const targetAllocationIp = targetIp || this.defaultAllocationIp;
    const allocations = await this.listAllocations(targetNode);

    const available = allocations.find(
      (alloc) => !alloc.assigned && alloc.ip === targetAllocationIp
    ) || allocations.find((alloc) => !alloc.assigned);

    if (!available) {
      throw new Error(
        `No available unassigned allocations found on node ${targetNode} (target IP: ${targetAllocationIp}).`
      );
    }

    return available;
  }

  /**
   * Creates a Minecraft server on Pterodactyl panel.
   */
  public async createServer(input: CreatePterodactylServerInput): Promise<PterodactylServer> {
    const url = `${this.baseUrl}/api/application/servers`;
    const eggId = input.eggId || this.defaultEggId;
    const nestId = input.nestId || this.defaultNestId;

    const payload = {
      name: input.name,
      user: input.userId,
      nest: nestId,
      egg: eggId,
      docker_image: input.dockerImage || process.env.PTERODACTYL_DOCKER_IMAGE?.trim() || "ghcr.io/pterodactyl/yolks:java_25",
      startup: input.startupCommand || process.env.PTERODACTYL_STARTUP_COMMAND?.trim() || "java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}}",
      environment: input.environment || {
        MINECRAFT_VERSION: "latest",
        SERVER_JARFILE: "paper.jar",
        BUILD_NUMBER: "latest",
      },
      limits: {
        memory: input.ramMb,
        swap: 0,
        disk: input.storageMb,
        io: 500,
        cpu: input.cpuLimit,
      },
      feature_limits: {
        databases: 0,
        allocations: 1,
        backups: 1,
      },
      allocation: {
        default: input.allocationId,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await this.handleResponseError("server creation", response);
    }

    const data = (await response.json()) as { attributes: PterodactylServer };
    return data.attributes;
  }

  /**
   * Deletes a server from Pterodactyl (used for rollback/reconciliation).
   */
  public async deleteServer(serverId: number, force = true): Promise<void> {
    const url = `${this.baseUrl}/api/application/servers/${serverId}${force ? "/force" : ""}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.headers,
    });

    if (!response.ok && response.status !== 404) {
      if (response.status === 401 || response.status === 403) {
        console.error("Warning: Pterodactyl API authorization failed (401/403) during server rollback deletion.");
      } else {
        const body = await response.text().catch(() => "");
        console.error(`Warning: Pterodactyl server deletion failed (${response.status}): ${body}`);
      }
    }
  }

  /**
   * Fetches details of a Pterodactyl server by ID.
   */
  public async getServer(serverId: number): Promise<PterodactylServer | null> {
    const url = `${this.baseUrl}/api/application/servers/${serverId}`;
    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      if (response.status === 404) return null;
      await this.handleResponseError("getServer", response);
    }

    const data = (await response.json()) as { attributes: PterodactylServer };
    return data.attributes;
  }
}
