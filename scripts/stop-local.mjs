#!/usr/bin/env node
import { rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runtimeDir = path.join(repoRoot, ".test-intelligence", "local-runtime");
const pidFile = path.join(runtimeDir, "workbench.pid");
const metaFile = path.join(runtimeDir, "workbench.json");
const DEFAULT_PORT = 1983;
const PORT_CHECK_TIMEOUT_MS = 2000;

const usage = `Usage: pnpm run local:stop -- [options]

Options:
  --timeout=<seconds>   Seconds to wait after SIGTERM before SIGKILL. Default: 15.
  --help                Print this help.
`;

const parseArgs = (argv) => {
  const options = { timeoutSeconds: 15 };
  for (const arg of argv) {
    if (arg === "--") {
      continue;
    } else if (arg === "--help") {
      options.help = true;
    } else if (arg.startsWith("--timeout=")) {
      options.timeoutSeconds = Number(arg.slice("--timeout=".length));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (
    !Number.isFinite(options.timeoutSeconds) ||
    options.timeoutSeconds < 1 ||
    options.timeoutSeconds > 120
  ) {
    throw new Error("--timeout must be a number between 1 and 120.");
  }
  return options;
};

const isProcessRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};

const readManagedPid = async () => {
  try {
    const raw = (await readFile(pidFile, "utf8")).trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const readManagedMeta = async () => {
  try {
    const raw = await readFile(metaFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(250, () => {
      socket.destroy();
      resolve(false);
    });
  });

const displayManagedTarget = (meta) => {
  if (meta?.url) return meta.url;
  if (Number.isInteger(meta?.port)) return `http://localhost:${meta.port}`;
  return null;
};

const describePortOwner = (port) => {
  let lsof;
  try {
    lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
  } catch {
    return null;
  }
  if (lsof.status !== 0) return null;
  const pids = (lsof.stdout ?? "")
    .trim()
    .split(/\s+/u)
    .map((entry) => Number(entry))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  return pids.length > 0 ? [...new Set(pids)] : null;
};

const killProcessGroup = (pid, signal) => {
  try {
    process.kill(-pid, signal);
  } catch (groupError) {
    try {
      process.kill(pid, signal);
    } catch (processError) {
      if (processError?.code !== "ESRCH" && groupError?.code !== "ESRCH") {
        throw processError;
      }
    }
  }
};

const waitUntilStopped = async ({ pid, timeoutMs }) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !isProcessRunning(pid);
};

const waitForPortClear = (port, timeoutMs) =>
  new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = async () => {
      if (await canConnect(port)) {
        if (Date.now() < deadline) {
          setTimeout(check, 250);
          return;
        }
        resolve(false);
        return;
      }
      resolve(true);
    };
    void check();
  });

const cleanup = async () => {
  await Promise.all([
    rm(pidFile, { force: true }),
    rm(metaFile, { force: true }),
  ]);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  const pid = await readManagedPid();
  const meta = await readManagedMeta();
  const managedUrl = displayManagedTarget(meta);
  if (managedUrl) {
    process.stdout.write(`Managed Workbench target: ${managedUrl}\n`);
  }
  const managedPort = Number.isInteger(meta?.port) ? meta.port : null;
  const targetPort = managedPort ?? DEFAULT_PORT;

  if (pid === null) {
    const listenerPids = describePortOwner(targetPort);
    if (listenerPids !== null) {
      process.stdout.write(
        `No managed local Workbench process found. Port ${targetPort} is in use by unmanaged process(es): ${listenerPids.join(", ")}.\n`,
      );
      process.stdout.write(
        `Please free port ${targetPort} locally if you want to start the Workbench there.\n`,
      );
    } else {
      process.stdout.write("No managed local Workbench process found.\n");
    }
    await cleanup();
    return;
  }

  if (Number.isInteger(meta?.pid) && meta.pid !== pid) {
    process.stdout.write(
      `Runtime metadata contained PID ${meta.pid} but runtime pid file contains ${pid}. Using pid ${pid} from pid file.\n`,
    );
  }

  if (!isProcessRunning(pid)) {
    const listenerPids = describePortOwner(targetPort);
    if (listenerPids !== null) {
      process.stdout.write(
        `Managed process ${pid} is not running. Port ${targetPort} is currently held by unmanaged process(es): ${listenerPids.join(", ")}.\n`,
      );
      process.stdout.write(
        `Runtime state will be cleaned; please free port ${targetPort} locally if needed.\n`,
      );
    }
    await cleanup();
    process.stdout.write(
      `Managed Workbench process ${pid} is not running. Runtime state cleaned.\n`,
    );
    return;
  }

  process.stdout.write(
    `Stopping managed Workbench process group ${pid} with SIGTERM...\n`,
  );
  killProcessGroup(pid, "SIGTERM");
  const stopped = await waitUntilStopped({
    pid,
    timeoutMs: options.timeoutSeconds * 1000,
  });
  if (!stopped) {
    process.stdout.write(
      `Process group ${pid} did not stop in time; sending SIGKILL...\n`,
    );
    killProcessGroup(pid, "SIGKILL");
    await waitUntilStopped({ pid, timeoutMs: 5_000 });
  }

  const portCleared = await waitForPortClear(targetPort, PORT_CHECK_TIMEOUT_MS);
  if (!portCleared) {
    const listenerPids = describePortOwner(targetPort);
    const owners =
      listenerPids === null ? "unknown process" : listenerPids.join(", ");
    process.stdout.write(
      `Port ${targetPort} is still in use by ${owners}. Please free it locally before restarting.\n`,
    );
  }

  await cleanup();
  process.stdout.write("Workbench stopped.\n");
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
