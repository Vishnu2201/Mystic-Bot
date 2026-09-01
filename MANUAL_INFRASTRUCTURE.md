# MysticServers — Manual Infrastructure & Gateway Requirements

This document specifies the exact host-level, network, and gateway infrastructure configurations required to support the Mystic Bot VPS hosting platform.

---

## 1. Automated Dynamic Public SSH Gateway (`iptables`)
The Mystic Bot automatically reconciles public SSH forwarding rules using dedicated custom `iptables` chains on the gateway machine (`129.225.66.174` / `ssh.mysticservers.com`).

### Dedicated Custom Chains:
- **`MYSTIC-VPS-SSH`** (Table: `nat`): Contains DNAT rules for active VPS instances (`tcp dport 22001-22100 -> 10.0.3.X:22`).
- **`MYSTIC-VPS-SSH-FWD`** (Table: `filter`): Permits stateful forwarding to VPS instances.
- **`MYSTIC-VPS-SSH-MASQ`** (Table: `nat`): Handles return path NAT for `10.0.3.0/24`.

### Required Gateway Prerequisites:
1. **Enable IPv4 Forwarding**:
   ```bash
   sudo sysctl -w net.ipv4.ip_forward=1
   echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
   ```

2. **Tailscale Subnet Routing**:
   The gateway machine reaches `10.0.3.0/24` via Tailscale (`tailscale0` interface):
   ```bash
   sudo tailscale up --accept-routes
   ```

3. **Persistent Firewall Rule Preservation**:
   To ensure custom chains survive reboot before the bot starts:
   ```bash
   sudo apt-get install -y iptables-persistent netfilter-persistent
   sudo netfilter-persistent save
   ```

---

## 2. LXC Host Reboot Persistence (`lxc-autostart`)
- **Bot Behavior**: Writes `lxc.start.auto = 1` into `/var/lib/lxc/<container>/config` during container creation.
- **Host Requirement**: The Linux LXC host systemd autostart service must be enabled:
  ```bash
  sudo systemctl enable lxc.service
  # or on Debian/Ubuntu systems:
  sudo systemctl enable lxc-net.service
  ```

---

## 3. Private Subnet & Network Configuration (`lxcbr0` / `dnsmasq`)
- **Subnet Specifications**:
  - **Subnet**: `10.0.3.0/24`
  - **Gateway / Host IP**: `10.0.3.1`
  - **Usable VPS Range**: `10.0.3.10` – `10.0.3.250`
- **Host Requirement**:
  - Verify bridge `lxcbr0` is active with IP `10.0.3.1/24`.
  - If using host `dnsmasq` for static IP enforcement alongside LXC static configuration, append static leases to `/etc/lxc/dnsmasq.conf`:
    ```conf
    dhcp-host=mystic-vps-000001,10.0.3.10
    dhcp-host=mystic-vps-000002,10.0.3.11
    ```

---

## 4. Troubleshooting & Verification Commands
- **Inspect Mystic Managed Gateway Chains**:
  ```bash
  sudo iptables -t nat -L MYSTIC-VPS-SSH -n -v --line-numbers
  sudo iptables -L MYSTIC-VPS-SSH-FWD -n -v
  ```
- **Test TCP Connectivity from Gateway**:
  ```bash
  nc -zv 10.0.3.210 22
  # or
  curl -v telnet://10.0.3.210:22
  ```

---

## 5. Storage Backend & Disk Quota Enforcement
- **Current Storage Backend**: Directory (`/var/lib/lxc`)
- **Quota Status**: Not enforced by directory backend (validated against total host disk free space prior to container creation).
- **Future Quota Requirement**: For hard per-container disk limits, migrate LXC storage to ZFS or Btrfs:
  ```bash
  # Example ZFS Storage Pool setup
  zfs create -o mountpoint=/var/lib/lxc tank/lxc
  zfs set quota=50G tank/lxc/mystic-vps-000001
  ```
