import { runCommandInVpsContainer } from "./vpsNodeService";

export type VpsTerminalSession = {
  sshCommand?: string;
  webUrl?: string;
};

export type TerminalProvider = {
  generate(containerName: string): Promise<VpsTerminalSession>;
  close(containerName: string): Promise<void>;
};

const SESSION_DIR = "/root/.mystic-tmate";
const SOCKET_FILE = `${SESSION_DIR}/tmate.sock`;
const STARTUP_LOG = `${SESSION_DIR}/startup.log`;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseSession(output: string): VpsTerminalSession {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sshCommand = lines.find((line) => /^ssh\s+.+@.+tmate\.io(?:\s+.*)?$/.test(line));
  const webUrl = lines.find((line) => /^https:\/\/.+tmate\.io(?:\/.*)?$/.test(line));

  if (!sshCommand && !webUrl) {
    throw new Error("tmate started but did not publish an SSH or web terminal address.");
  }

  return { sshCommand, webUrl };
}

async function generateTmateTerminalSession(
  containerName: string
): Promise<VpsTerminalSession> {
  const command = `
set -eu
export DEBIAN_FRONTEND=noninteractive

if ! command -v tmate >/dev/null 2>&1; then
  apt-get update -y || { echo "tmate installation failed: package index update failed" >&2; exit 1; }
  apt-get install -y tmate || { echo "tmate installation failed: package install failed" >&2; exit 1; }
fi
tmate -V >/dev/null || { echo "tmate binary cannot execute" >&2; exit 1; }

mkdir -p ${shellQuote(SESSION_DIR)}
chmod 700 ${shellQuote(SESSION_DIR)}

# Reuse an existing live session when possible.
if [ -S ${shellQuote(SOCKET_FILE)} ]; then
  if tmate -S ${shellQuote(SOCKET_FILE)} has-session 2>/dev/null; then
    ssh_url="$(tmate -S ${shellQuote(SOCKET_FILE)} display -p '#{tmate_ssh}' 2>/dev/null || true)"
    web_url="$(tmate -S ${shellQuote(SOCKET_FILE)} display -p '#{tmate_web}' 2>/dev/null || true)"
    if [ -n "$ssh_url" ] || [ -n "$web_url" ]; then
      [ -n "$ssh_url" ] && printf '%s\\n' "$ssh_url"
      [ -n "$web_url" ] && printf '%s\\n' "$web_url"
      exit 0
    fi
  fi
  rm -f ${shellQuote(SOCKET_FILE)}
fi

# Start a detached tmate server. The socket lets us query the real connection
# details instead of trying to scrape tmate's terminal output.
rm -f ${shellQuote(STARTUP_LOG)}
tmate -S ${shellQuote(SOCKET_FILE)} new-session -d 'exec sh -c "while :; do sleep 3600; done"' >${shellQuote(STARTUP_LOG)} 2>&1 || {
  echo "tmate session failed: detached session startup command failed" >&2
  exit 1
}

# tmate 2.4 signals this once its relay client is connected. Keep polling below
# as a compatibility fallback, but do not assume server creation means relay ready.
timeout 45 tmate -S ${shellQuote(SOCKET_FILE)} wait tmate-ready >>${shellQuote(STARTUP_LOG)} 2>&1 || true

ready=0
for i in $(seq 1 90); do
  if tmate -S ${shellQuote(SOCKET_FILE)} has-session 2>/dev/null; then
    ssh_url="$(tmate -S ${shellQuote(SOCKET_FILE)} display -p '#{tmate_ssh}' 2>/dev/null || true)"
    web_url="$(tmate -S ${shellQuote(SOCKET_FILE)} display -p '#{tmate_web}' 2>/dev/null || true)"
    if [ -n "$ssh_url" ] || [ -n "$web_url" ]; then
      [ -n "$ssh_url" ] && printf '%s\\n' "$ssh_url"
      [ -n "$web_url" ] && printf '%s\\n' "$web_url"
      ready=1
      break
    fi
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  if ! getent hosts ssh.tmate.io >/dev/null 2>&1; then
    echo "tmate session failed: DNS lookup for ssh.tmate.io failed" >&2
  elif ! tmate -S ${shellQuote(SOCKET_FILE)} has-session 2>/dev/null; then
    echo "tmate session failed: detached session is no longer running" >&2
  elif ! timeout 5 bash -c '>/dev/tcp/ssh.tmate.io/2200' >/dev/null 2>&1; then
    echo "tmate session failed: TCP connection to ssh.tmate.io:2200 failed" >&2
  else
    echo "tmate session failed: relay connection never published endpoint variables" >&2
  fi
  exit 1
fi
`;

  const output = await runCommandInVpsContainer(
    containerName,
    command,
    180_000
  );

  return parseSession(output);
}

const tmateTerminalProvider: TerminalProvider = {
  generate: generateTmateTerminalSession,
  close: closeVpsTerminalSession,
};

export async function generateVpsTerminalSession(containerName: string): Promise<VpsTerminalSession> {
  return tmateTerminalProvider.generate(containerName);
}

export async function diagnoseVpsTerminalSession(containerName: string): Promise<string> {
  return runCommandInVpsContainer(containerName, `
set +e
printf 'hostname='; hostname 2>/dev/null || echo unavailable
printf 'current_user='; id -un 2>/dev/null || echo unavailable
printf 'tmate_installed='; command -v tmate >/dev/null 2>&1 && echo yes || echo no
printf 'tmate_version='; tmate -V 2>/dev/null || echo unavailable
printf 'dns_ssh_tmate='; getent hosts ssh.tmate.io >/dev/null 2>&1 && echo ok || echo failed
printf 'relay_tcp_2200='; timeout 5 bash -c '>/dev/tcp/ssh.tmate.io/2200' >/dev/null 2>&1 && echo ok || echo failed
printf 'relay_tcp_22='; timeout 5 bash -c '>/dev/tcp/ssh.tmate.io/22' >/dev/null 2>&1 && echo ok || echo failed
printf 'socket_present='; [ -S ${shellQuote(SOCKET_FILE)} ] && echo yes || echo no
printf 'session_running='; tmate -S ${shellQuote(SOCKET_FILE)} has-session >/dev/null 2>&1 && echo yes || echo no
printf 'tmate_process='; pgrep -x tmate >/dev/null 2>&1 && echo running || echo absent
printf 'ssh_endpoint_published='; tmate -S ${shellQuote(SOCKET_FILE)} display -p '#{tmate_ssh}' 2>/dev/null | grep -q . && echo yes || echo no
printf 'web_endpoint_published='; tmate -S ${shellQuote(SOCKET_FILE)} display -p '#{tmate_web}' 2>/dev/null | grep -q . && echo yes || echo no
printf 'tmate_messages='; tmate -S ${shellQuote(SOCKET_FILE)} show-messages 2>/dev/null | tail -n 3 | sed -E 's#(ssh |https://)[^ ]+#<redacted-session-url>#g' | tr '\n' ' ' || true; echo
printf 'startup_log='; [ -f ${shellQuote(STARTUP_LOG)} ] && tail -n 3 ${shellQuote(STARTUP_LOG)} | sed -E 's#(ssh |https://)[^ ]+#<redacted-session-url>#g' | tr '\n' ' ' || true; echo
`, 30_000);
}

export async function closeVpsTerminalSession(
  containerName: string
): Promise<void> {
  await runCommandInVpsContainer(
    containerName,
    `
set -eu
if [ -S ${shellQuote(SOCKET_FILE)} ]; then
  tmate -S ${shellQuote(SOCKET_FILE)} kill-server 2>/dev/null || true
fi
rm -f ${shellQuote(SOCKET_FILE)}
`,
    30_000
  );
}

export async function regenerateVpsTerminalSession(
  containerName: string
): Promise<VpsTerminalSession> {
  await closeVpsTerminalSession(containerName);
  return generateVpsTerminalSession(containerName);
}
