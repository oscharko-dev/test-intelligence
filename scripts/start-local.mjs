#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workbenchDir = path.join(repoRoot, "apps/workbench");
const runtimeDir = path.join(repoRoot, ".test-intelligence", "local-runtime");
const pidFile = path.join(runtimeDir, "workbench.pid");
const metaFile = path.join(runtimeDir, "workbench.json");
const logFile = path.join(runtimeDir, "workbench.log");
const workbenchBuildMarker = path.join(workbenchDir, ".next", "BUILD_ID");

const usage = `Usage: pnpm run local:start -- [options]

Options:
  --mode=dev|prod       Start Next.js in dev mode or production mode. Default: dev.
  --port=<port>         Workbench port. Default: 1983.
  --env-file=<path>     Optional dotenv file to load before starting. Default: none.
  --no-env-file         Do not load a dotenv file.
  --mock                Start with WORKBENCH_RUNNER_MODE=mock for UI-only local runs.
  --help                Print this help.
`;

const parseArgs = (argv) => {
  const options = {
    envFile: null,
    mode: "dev",
    mock: false,
    port: 1983,
  };
  for (const arg of argv) {
    if (arg === "--") {
      continue;
    } else if (arg === "--help") {
      options.help = true;
    } else if (arg === "--mock") {
      options.mock = true;
    } else if (arg === "--no-env-file") {
      options.envFile = null;
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
    } else if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = path.resolve(repoRoot, arg.slice("--env-file=".length));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (options.mode !== "dev" && options.mode !== "prod") {
    throw new Error("--mode must be either dev or prod.");
  }
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535
  ) {
    throw new Error("--port must be a valid TCP port.");
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
    return JSON.parse(await readFile(metaFile, "utf8"));
  } catch {
    return null;
  }
};

const cleanupRuntimeState = async () => {
  await Promise.all([
    rm(pidFile, { force: true }),
    rm(metaFile, { force: true }),
  ]);
};

const parseDotenv = async (filePath) => {
  if (filePath === null) return {};
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  const values = {};
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (match === null) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });

const waitForPort = async ({ port, pid, timeoutMs }) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true;
    if (!isProcessRunning(pid)) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

const tailLog = async () => {
  try {
    const content = await readFile(logFile, "utf8");
    return content.split(/\r?\n/u).slice(-30).join("\n");
  } catch {
    return "";
  }
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

const pathExists = async (target) => {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const ensureNodeModules = async (env) => {
  const hasRootModules = await pathExists(path.join(repoRoot, "node_modules"));
  const hasWorkbenchModules = await pathExists(
    path.join(workbenchDir, "node_modules"),
  );

  if (hasRootModules && hasWorkbenchModules) {
    return false;
  }

  process.stdout.write(
    "[local-start] node_modules missing. Running pnpm install before start.\n",
  );
  const install = spawnSync("pnpm", ["install"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (install.status !== 0) {
    throw new Error("pnpm install failed.");
  }
  return true;
};

const rebuildNativeDependencies = (env) => {
  process.stdout.write(
    "[local-start] Rebuilding native SQLite dependency after install.\n",
  );
  const rebuild = spawnSync("pnpm", ["rebuild", "better-sqlite3"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (rebuild.status !== 0) {
    throw new Error("pnpm rebuild better-sqlite3 failed.");
  }
};

const ensureFrontendBuilt = async (env) => {
  if (await pathExists(workbenchBuildMarker)) {
    return;
  }

  process.stdout.write(
    "[local-start] Frontend build missing. Running apps/workbench build.\n",
  );
  const build = spawnSync("pnpm", ["--dir", "apps/workbench", "build"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    throw new Error("Workbench build failed.");
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  await mkdir(runtimeDir, { recursive: true });

  const existingPid = await readManagedPid();
  if (existingPid !== null && isProcessRunning(existingPid)) {
    const meta = await readManagedMeta();
    const url =
      meta?.pid === existingPid && typeof meta.url === "string"
        ? meta.url
        : `http://localhost:${meta?.port ?? options.port}`;
    process.stdout.write(
      `Workbench is already running at ${url} (pid ${existingPid}).\n`,
    );
    return;
  }
  if (existingPid !== null) {
    await cleanupRuntimeState();
  }

  if (await canConnect(options.port)) {
    throw new Error(
      `Port ${options.port} is already in use. Please free this port locally and rerun the start command.`,
    );
  }

  const pnpm = spawnSync("pnpm", ["--version"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (pnpm.status !== 0) {
    throw new Error("pnpm is required but was not found on PATH.");
  }

  const dotenv = await parseDotenv(options.envFile);
  const env = {
    ...dotenv,
    ...process.env,
    WORKBENCH_REPO_ROOT: repoRoot,
  };
  if (options.mock) {
    env.WORKBENCH_RUNNER_MODE = "mock";
  }

  if (await ensureNodeModules(env)) {
    rebuildNativeDependencies(env);
  }
  await ensureFrontendBuilt(env);

  const command = options.mode === "prod" ? "start" : "dev";
  const log = await open(logFile, "a");
  let child = null;
  let stateWritten = false;
  try {
    await log.write(
      `\n[local-start] ${new Date().toISOString()} mode=${options.mode} port=${options.port} mock=${options.mock}\n`,
    );
    child = spawn(
      "pnpm",
      [
        "--dir",
        "apps/workbench",
        "exec",
        "next",
        command,
        "--port",
        String(options.port),
      ],
      {
        cwd: repoRoot,
        detached: true,
        env,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    child.unref();

    const ready = await waitForPort({
      pid: child.pid,
      port: options.port,
      timeoutMs: 90_000,
    });
    if (!ready) {
      const recentLog = await tailLog();
      throw new Error(
        `Workbench did not become ready on port ${options.port}.\nLog: ${logFile}\n${recentLog}`,
      );
    }

    const metadata = {
      mode: options.mode,
      mock: options.mock,
      pid: child.pid,
      port: options.port,
      startedAt: new Date().toISOString(),
      url: `http://localhost:${options.port}`,
    };
    await writeFile(pidFile, `${child.pid}\n`, "utf8");
    await writeFile(metaFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    stateWritten = true;
  } catch (error) {
    if (child?.pid !== undefined && isProcessRunning(child.pid)) {
      killProcessGroup(child.pid, "SIGTERM");
    }
    if (!stateWritten) {
      await cleanupRuntimeState();
    }
    throw error;
  } finally {
    await log.close();
  }

  process.stdout.write(`Workbench started: http://localhost:${options.port}\n`);
  process.stdout.write(`PID: ${child.pid}\n`);
  process.stdout.write(`Log: ${logFile}\n`);
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
