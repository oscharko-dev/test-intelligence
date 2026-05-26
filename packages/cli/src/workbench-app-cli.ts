import { spawn, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface CommandSink {
  readonly stdout: (chunk: string) => void;
  readonly stderr: (chunk: string) => void;
}

interface StartOptions {
  readonly envFile: string | null;
  readonly help?: boolean;
  readonly mock: boolean;
  readonly port: number;
  readonly workspaceRoot: string;
}

interface StopOptions {
  readonly help?: boolean;
  readonly timeoutSeconds: number;
  readonly workspaceRoot: string;
}

const DEFAULT_PORT = 1983;
const PORT_CHECK_TIMEOUT_MS = 2_000;

export const TEST_INTELLIGENCE_WORKBENCH_START_HELP = `Start the local Test Intelligence Workbench UI from the installed package.

Usage:
  test-intelligence start [options]

Options:
  --port=<port>         Workbench port. Default: 1983.
  --workspace=<path>    Workspace for .env, test-case/, and .test-intelligence/. Default: current directory.
  --env-file=<path>     Dotenv file to load before starting. Default: <workspace>/.env.
  --no-env-file         Do not load a dotenv file.
  --mock                Start with WORKBENCH_RUNNER_MODE=mock for UI-only local runs.
  --help                Print this help.
`;

export const TEST_INTELLIGENCE_WORKBENCH_STOP_HELP = `Stop the managed local Test Intelligence Workbench UI.

Usage:
  test-intelligence stop [options]

Options:
  --workspace=<path>      Workspace containing .test-intelligence/local-runtime/. Default: current directory.
  --timeout=<seconds>     Seconds to wait after SIGTERM before SIGKILL. Default: 15.
  --help                  Print this help.
`;

class WorkbenchCliError extends Error {}

const parsePort = (value: string): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new WorkbenchCliError("--port must be a valid TCP port.");
  }
  return port;
};

const resolveWorkspaceRoot = (value: string | undefined): string =>
  path.resolve(value ?? process.cwd());

const parseStartArgs = (argv: ReadonlyArray<string>): StartOptions => {
  let envFile: string | null | undefined;
  let help = false;
  let mock = false;
  let port = DEFAULT_PORT;
  let workspaceRoot = resolveWorkspaceRoot(undefined);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--mock") {
      mock = true;
    } else if (arg === "--no-env-file") {
      envFile = null;
    } else if (arg === "--port") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new WorkbenchCliError("Missing value for --port.");
      }
      port = parsePort(value);
      index += 1;
    } else if (arg.startsWith("--port=")) {
      port = parsePort(arg.slice("--port=".length));
    } else if (arg === "--workspace") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new WorkbenchCliError("Missing value for --workspace.");
      }
      workspaceRoot = resolveWorkspaceRoot(value);
      index += 1;
    } else if (arg.startsWith("--workspace=")) {
      workspaceRoot = resolveWorkspaceRoot(arg.slice("--workspace=".length));
    } else if (arg === "--env-file") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new WorkbenchCliError("Missing value for --env-file.");
      }
      envFile = path.resolve(value);
      index += 1;
    } else if (arg.startsWith("--env-file=")) {
      envFile = path.resolve(arg.slice("--env-file=".length));
    } else {
      throw new WorkbenchCliError(`Unknown option: ${arg}`);
    }
  }

  return {
    envFile: envFile === undefined ? path.join(workspaceRoot, ".env") : envFile,
    help,
    mock,
    port,
    workspaceRoot,
  };
};

const parseStopArgs = (argv: ReadonlyArray<string>): StopOptions => {
  let help = false;
  let timeoutSeconds = 15;
  let timeoutRawValue = String(timeoutSeconds);
  let workspaceRoot = resolveWorkspaceRoot(undefined);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--workspace") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new WorkbenchCliError("Missing value for --workspace.");
      }
      workspaceRoot = resolveWorkspaceRoot(value);
      index += 1;
    } else if (arg.startsWith("--workspace=")) {
      workspaceRoot = resolveWorkspaceRoot(arg.slice("--workspace=".length));
    } else if (arg === "--timeout") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new WorkbenchCliError("Missing value for --timeout.");
      }
      timeoutRawValue = value;
      timeoutSeconds = Number(value);
      index += 1;
    } else if (arg.startsWith("--timeout=")) {
      timeoutRawValue = arg.slice("--timeout=".length);
      timeoutSeconds = Number(timeoutRawValue);
    } else {
      throw new WorkbenchCliError(`Unknown option: ${arg}`);
    }
  }

  if (
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 120
  ) {
    throw new WorkbenchCliError(
      `--timeout received ${JSON.stringify(timeoutRawValue)}; expected a number between 1 and 120.`,
    );
  }

  return { help, timeoutSeconds, workspaceRoot };
};

const resolvePackageRoot = (): string => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  if (path.basename(currentDir) === "dist") {
    return path.resolve(currentDir, "..");
  }
  return path.resolve(currentDir, "..", "..", "..");
};

const resolveWorkbenchRoot = async (): Promise<string> => {
  const packageRoot = resolvePackageRoot();
  const packagedWorkbench = path.join(packageRoot, "dist", "workbench");
  if (await pathExists(path.join(packagedWorkbench, ".next", "BUILD_ID"))) {
    return packagedWorkbench;
  }

  const repoWorkbench = path.join(packageRoot, "apps", "workbench");
  if (await pathExists(path.join(repoWorkbench, ".next", "BUILD_ID"))) {
    return repoWorkbench;
  }

  throw new WorkbenchCliError(
    "Workbench build artifacts are missing. Reinstall the package or run the repository build before starting the Workbench.",
  );
};

const runtimePaths = (workspaceRoot: string) => {
  const runtimeDir = path.join(
    workspaceRoot,
    ".test-intelligence",
    "local-runtime",
  );
  return {
    logFile: path.join(runtimeDir, "workbench.log"),
    metaFile: path.join(runtimeDir, "workbench.json"),
    pidFile: path.join(runtimeDir, "workbench.pid"),
    runtimeDir,
  };
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
};

const readManagedPid = async (
  workspaceRoot: string,
): Promise<number | null> => {
  try {
    const raw = (
      await readFile(runtimePaths(workspaceRoot).pidFile, "utf8")
    ).trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const readManagedMeta = async (
  workspaceRoot: string,
): Promise<Record<string, unknown> | null> => {
  try {
    return JSON.parse(
      await readFile(runtimePaths(workspaceRoot).metaFile, "utf8"),
    );
  } catch {
    return null;
  }
};

const cleanupRuntimeState = async (workspaceRoot: string): Promise<void> => {
  const paths = runtimePaths(workspaceRoot);
  await Promise.all([
    rm(paths.pidFile, { force: true }),
    rm(paths.metaFile, { force: true }),
  ]);
};

const parseDotenv = async (
  filePath: string | null,
): Promise<Record<string, string>> => {
  if (filePath === null) return {};
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    throw error;
  }

  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
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

const canConnect = (port: number): Promise<boolean> =>
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

const waitForPort = async ({
  pid,
  port,
  timeoutMs,
}: {
  readonly pid: number;
  readonly port: number;
  readonly timeoutMs: number;
}): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true;
    if (!isProcessRunning(pid)) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

const tailLog = async (workspaceRoot: string): Promise<string> => {
  try {
    const content = await readFile(runtimePaths(workspaceRoot).logFile, "utf8");
    return content.split(/\r?\n/u).slice(-30).join("\n");
  } catch {
    return "";
  }
};

const killProcessGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch (groupError) {
    try {
      process.kill(pid, signal);
    } catch (processError) {
      const groupCode = (groupError as NodeJS.ErrnoException)?.code;
      const processCode = (processError as NodeJS.ErrnoException)?.code;
      if (groupCode !== "ESRCH" && processCode !== "ESRCH") {
        throw processError;
      }
    }
  }
};

const waitUntilStopped = async ({
  pid,
  timeoutMs,
}: {
  readonly pid: number;
  readonly timeoutMs: number;
}): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !isProcessRunning(pid);
};

const describePortOwner = (port: number): readonly number[] | null => {
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

const waitForPortClear = (port: number, timeoutMs: number): Promise<boolean> =>
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

const resolveNextBin = (): string | null => {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("next/dist/bin/next");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
};

export const runWorkbenchStartCommand = async (
  argv: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  let options: StartOptions;
  try {
    options = parseStartArgs(argv);
  } catch (error) {
    if (error instanceof WorkbenchCliError) {
      sink.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  if (options.help) {
    sink.stdout(TEST_INTELLIGENCE_WORKBENCH_START_HELP);
    return 0;
  }

  const paths = runtimePaths(options.workspaceRoot);
  await mkdir(paths.runtimeDir, { recursive: true });

  const existingPid = await readManagedPid(options.workspaceRoot);
  if (existingPid !== null && isProcessRunning(existingPid)) {
    const meta = await readManagedMeta(options.workspaceRoot);
    const url =
      typeof meta?.url === "string"
        ? meta.url
        : `http://localhost:${String(meta?.port ?? options.port)}`;
    sink.stdout(
      `Workbench is already running at ${url} (pid ${existingPid}).\n`,
    );
    return 0;
  }
  if (existingPid !== null) {
    await cleanupRuntimeState(options.workspaceRoot);
  }

  if (await canConnect(options.port)) {
    sink.stderr(
      `error: Port ${options.port} is already in use. Please free this port locally and rerun the start command.\n`,
    );
    return 1;
  }

  const workbenchRoot = await resolveWorkbenchRoot();
  const nextBin = resolveNextBin();
  if (nextBin === null || !(await pathExists(nextBin))) {
    sink.stderr(
      "error: Next.js runtime is missing. Reinstall @oscharko-dev/test-intelligence before starting the Workbench.\n",
    );
    return 1;
  }

  const dotenv = await parseDotenv(options.envFile);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...dotenv,
    NEXT_TELEMETRY_DISABLED: "1",
    WORKBENCH_REPO_ROOT: options.workspaceRoot,
  };
  if (options.mock) {
    env.WORKBENCH_RUNNER_MODE = "mock";
  }

  const log = await open(paths.logFile, "a");
  let child: ReturnType<typeof spawn> | null = null;
  let stateWritten = false;
  try {
    await log.write(
      `\n[workbench-start] ${new Date().toISOString()} port=${options.port} workspace=${options.workspaceRoot} mock=${options.mock}\n`,
    );
    child = spawn(
      process.execPath,
      [
        nextBin,
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(options.port),
      ],
      {
        cwd: workbenchRoot,
        detached: true,
        env,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    child.unref();

    const pid = child.pid;
    if (pid === undefined) {
      throw new WorkbenchCliError("Workbench process did not expose a PID.");
    }

    const ready = await waitForPort({
      pid,
      port: options.port,
      timeoutMs: 90_000,
    });
    if (!ready) {
      const recentLog = await tailLog(options.workspaceRoot);
      throw new WorkbenchCliError(
        `Workbench did not become ready on port ${options.port}.\nLog: ${paths.logFile}\n${recentLog}`,
      );
    }

    const metadata = {
      mock: options.mock,
      pid,
      port: options.port,
      startedAt: new Date().toISOString(),
      url: `http://localhost:${options.port}`,
      workspaceRoot: options.workspaceRoot,
    };
    await writeFile(paths.pidFile, `${pid}\n`, "utf8");
    await writeFile(
      paths.metaFile,
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    stateWritten = true;

    sink.stdout(`Workbench started: http://localhost:${options.port}\n`);
    sink.stdout(`PID: ${pid}\n`);
    sink.stdout(`Log: ${paths.logFile}\n`);
    return 0;
  } catch (error) {
    const pid = child?.pid;
    if (pid !== undefined && isProcessRunning(pid)) {
      killProcessGroup(pid, "SIGTERM");
    }
    if (!stateWritten) {
      await cleanupRuntimeState(options.workspaceRoot);
    }
    if (error instanceof WorkbenchCliError) {
      sink.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  } finally {
    await log.close();
  }
};

export const runWorkbenchStopCommand = async (
  argv: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  let options: StopOptions;
  try {
    options = parseStopArgs(argv);
  } catch (error) {
    if (error instanceof WorkbenchCliError) {
      sink.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  if (options.help) {
    sink.stdout(TEST_INTELLIGENCE_WORKBENCH_STOP_HELP);
    return 0;
  }

  const pid = await readManagedPid(options.workspaceRoot);
  const meta = await readManagedMeta(options.workspaceRoot);
  const managedPort =
    meta !== null && Number.isInteger(meta.port) ? Number(meta.port) : null;
  const targetPort = managedPort ?? DEFAULT_PORT;

  if (typeof meta?.url === "string") {
    sink.stdout(`Managed Workbench target: ${meta.url}\n`);
  }

  if (pid === null) {
    const listenerPids = describePortOwner(targetPort);
    if (listenerPids !== null) {
      sink.stdout(
        `No managed local Workbench process found. Port ${targetPort} is in use by unmanaged process(es): ${listenerPids.join(", ")}.\n`,
      );
      sink.stdout(
        `Please free port ${targetPort} locally if you want to start the Workbench there.\n`,
      );
    } else {
      sink.stdout("No managed local Workbench process found.\n");
    }
    await cleanupRuntimeState(options.workspaceRoot);
    return 0;
  }

  if (!isProcessRunning(pid)) {
    await cleanupRuntimeState(options.workspaceRoot);
    sink.stdout(
      `Managed Workbench process ${pid} is not running. Runtime state cleaned.\n`,
    );
    return 0;
  }

  sink.stdout(
    `Stopping managed Workbench process group ${pid} with SIGTERM...\n`,
  );
  killProcessGroup(pid, "SIGTERM");
  const stopped = await waitUntilStopped({
    pid,
    timeoutMs: options.timeoutSeconds * 1000,
  });
  if (!stopped) {
    sink.stdout(
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
    sink.stdout(
      `Port ${targetPort} is still in use by ${owners}. Please free it locally before restarting.\n`,
    );
  }

  await cleanupRuntimeState(options.workspaceRoot);
  sink.stdout("Workbench stopped.\n");
  return 0;
};
