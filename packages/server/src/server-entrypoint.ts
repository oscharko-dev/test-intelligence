/**
 * Container ENTRYPOINT for the standalone Test Intelligence runtime (#30).
 *
 * The standalone CLI (#20) is a verification toolbox (audit-verify,
 * verify-provenance, calibration-refit, …) — it intentionally does NOT
 * expose a `start` subcommand. The container therefore needs its own
 * PID-1 process whose job is narrow: parse env, build a JSON-line logger,
 * call {@link createTestIntelligenceServer}, install signal handlers,
 * and exit cleanly. No business logic lives here.
 *
 * The entrypoint is wired into the image as:
 *
 *   ENTRYPOINT ["node", "/opt/test-intelligence/dist/server-entrypoint.js"]
 *
 * Behaviour rules:
 *
 *   - Defaults to binding on `0.0.0.0:1983` (the container is its own
 *     network namespace; loopback-only binding would prevent the operator
 *     from publishing the port via `-p`). The host system is still
 *     expected to bind the published port to loopback only.
 *
 *   - SIGTERM / SIGINT trigger a graceful close. The process exits 0
 *     once the underlying `http.Server` has finished its drain, or after
 *     {@link SHUTDOWN_GRACE_MS} have elapsed (whichever is sooner).
 *
 *   - Bind errors (`EADDRINUSE`, malformed host) exit 1 with a
 *     structured log line; no stack trace is leaked.
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createWorkspaceLogger } from "@oscharko-dev/ti-security";
import { createTestIntelligenceServer } from "./server.js";

/** Maximum drain budget after SIGTERM before forcing a hard exit. */
export const SHUTDOWN_GRACE_MS: number = 10_000;

/** IANA upper bound on a TCP port. */
const MAX_TCP_PORT: number = 65_535;

/** Default values applied when no env overrides are present. */
const CONTAINER_DEFAULTS = {
  host: "0.0.0.0",
  port: 1983,
  requestsPerMinute: 60,
  logFormat: "json" as const,
  logLabel: "test-intelligence",
};

/** Resolved configuration shape consumed by {@link runServerEntrypoint}. */
export interface ServerEntrypointConfig {
  readonly host: string;
  readonly port: number;
  readonly requestsPerMinute: number;
  readonly allowedCorsOrigins: ReadonlyArray<string>;
  readonly bearerToken: string | undefined;
  readonly logFormat: "json" | "text";
  readonly logLabel: string;
}

/** Thrown when an operator-supplied env var is malformed. */
export class ServerEntrypointConfigError extends Error {
  public readonly envName: string;

  public constructor(envName: string, reason: string) {
    super(`${envName}: ${reason}`);
    this.name = "ServerEntrypointConfigError";
    this.envName = envName;
  }
}

const parseIntegerEnv = ({
  raw,
  envName,
  min,
  max,
}: {
  raw: string;
  envName: string;
  min: number;
  max: number;
}): number => {
  if (!/^-?\d+$/.test(raw)) {
    throw new ServerEntrypointConfigError(
      envName,
      `expected an integer, received "${raw}"`,
    );
  }
  const value = Number.parseInt(raw, 10);
  if (value < min || value > max) {
    throw new ServerEntrypointConfigError(
      envName,
      `must be in [${String(min)}, ${String(max)}], received ${String(value)}`,
    );
  }
  return value;
};

const parseLogFormat = (raw: string): "json" | "text" => {
  if (raw === "json" || raw === "text") {
    return raw;
  }
  throw new ServerEntrypointConfigError(
    "TEST_INTELLIGENCE_LOG_FORMAT",
    `expected "json" or "text", received "${raw}"`,
  );
};

const parseCorsOrigins = (raw: string): ReadonlyArray<string> =>
  raw
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

/**
 * Resolve the runtime configuration from environment variables.
 *
 * Pure function — does no I/O; the test seam is the `env` argument.
 */
export const parseServerEntrypointConfig = (
  env: NodeJS.ProcessEnv,
): ServerEntrypointConfig => {
  const hostRaw = env["TEST_INTELLIGENCE_HOST"];
  const portRaw = env["TEST_INTELLIGENCE_PORT"];
  const rpmRaw = env["TEST_INTELLIGENCE_REQUESTS_PER_MINUTE"];
  const corsRaw = env["TEST_INTELLIGENCE_CORS_ORIGINS"];
  const bearerRaw = env["TEST_INTELLIGENCE_BEARER_TOKEN"];
  const formatRaw = env["TEST_INTELLIGENCE_LOG_FORMAT"];

  const host =
    hostRaw !== undefined && hostRaw.length > 0
      ? hostRaw
      : CONTAINER_DEFAULTS.host;

  const port =
    portRaw !== undefined && portRaw.length > 0
      ? parseIntegerEnv({
          raw: portRaw,
          envName: "TEST_INTELLIGENCE_PORT",
          min: 0,
          max: MAX_TCP_PORT,
        })
      : CONTAINER_DEFAULTS.port;

  const requestsPerMinute =
    rpmRaw !== undefined && rpmRaw.length > 0
      ? parseIntegerEnv({
          raw: rpmRaw,
          envName: "TEST_INTELLIGENCE_REQUESTS_PER_MINUTE",
          min: 1,
          max: 1_000_000,
        })
      : CONTAINER_DEFAULTS.requestsPerMinute;

  const allowedCorsOrigins =
    corsRaw !== undefined ? parseCorsOrigins(corsRaw) : [];

  const bearerToken =
    bearerRaw !== undefined && bearerRaw.length > 0 ? bearerRaw : undefined;

  const logFormat =
    formatRaw !== undefined && formatRaw.length > 0
      ? parseLogFormat(formatRaw)
      : CONTAINER_DEFAULTS.logFormat;

  return {
    host,
    port,
    requestsPerMinute,
    allowedCorsOrigins,
    bearerToken,
    logFormat,
    logLabel: CONTAINER_DEFAULTS.logLabel,
  };
};

/** Help text printed when the entrypoint is invoked with `--help`. */
export const CONTAINER_HELP_TEXT: string = `test-intelligence — container entrypoint for the standalone HTTP server.

Usage:
  test-intelligence [--help|-h|help]

The container reads its configuration from environment variables:

  TEST_INTELLIGENCE_HOST                 Bind host (default 0.0.0.0 inside the container).
  TEST_INTELLIGENCE_PORT                 Bind port (default 1983; 0 = ephemeral).
  TEST_INTELLIGENCE_REQUESTS_PER_MINUTE  Per-client rate-limit budget (default 60).
  TEST_INTELLIGENCE_CORS_ORIGINS         Comma-separated allowed CORS origins.
  TEST_INTELLIGENCE_BEARER_TOKEN         Operator bearer token (no default).
  TEST_INTELLIGENCE_LOG_FORMAT           "json" (default) or "text".

The server exposes these standalone routes:

  GET /healthz, GET /readyz, GET /openapi.json, GET /api/v1/*

Signals:
  SIGTERM / SIGINT trigger a graceful close (drain budget 10s).
`;

/** Return a copy of {@link CONTAINER_HELP_TEXT}. */
export const renderContainerHelp = (): string => CONTAINER_HELP_TEXT;

/** Match the canonical help-flag variants. */
export const isContainerHelpFlag = (argv: ReadonlyArray<string>): boolean => {
  const first = argv[0];
  return first === "--help" || first === "-h" || first === "help";
};

/** Result returned by {@link runServerEntrypoint}. */
export interface ServerEntrypointResult {
  readonly exitCode: number;
  readonly action: "help" | "served" | "config-error" | "bind-error";
}

/** Test-seam side effects for {@link runServerEntrypoint}. */
export interface ServerEntrypointIO {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const DEFAULT_IO: ServerEntrypointIO = {
  stdout: (line) => {
    process.stdout.write(line);
  },
  stderr: (line) => {
    process.stderr.write(line);
  },
};

/**
 * Bootstrap the container entrypoint. Resolves to the intended exit code.
 *
 * The function returns rather than calling `process.exit` directly so it
 * is unit-testable and so the production wrapper at the bottom of this
 * file can flush the logger before terminating.
 */
export const runServerEntrypoint = async ({
  argv,
  env,
  io = DEFAULT_IO,
  onReady,
}: {
  argv: ReadonlyArray<string>;
  env: NodeJS.ProcessEnv;
  io?: ServerEntrypointIO;
  /** Test hook: called after the server has bound. Receives the live server. */
  onReady?: (handle: {
    close: () => Promise<void>;
    host: string;
    port: number;
  }) => Promise<void> | void;
}): Promise<ServerEntrypointResult> => {
  if (isContainerHelpFlag(argv)) {
    io.stdout(renderContainerHelp());
    return { exitCode: 0, action: "help" };
  }

  let config: ServerEntrypointConfig;
  try {
    config = parseServerEntrypointConfig(env);
  } catch (error) {
    if (error instanceof ServerEntrypointConfigError) {
      io.stderr(`error: ${error.message}\n`);
      return { exitCode: 1, action: "config-error" };
    }
    throw error;
  }

  const logger = createWorkspaceLogger({
    format: config.logFormat,
    label: config.logLabel,
  });

  let serverHandle: Awaited<ReturnType<typeof createTestIntelligenceServer>>;
  try {
    serverHandle = await createTestIntelligenceServer({
      host: config.host,
      port: config.port,
      logger,
      requestsPerMinute: config.requestsPerMinute,
      allowedCorsOrigins: config.allowedCorsOrigins,
      ...(config.bearerToken !== undefined
        ? { bearerToken: config.bearerToken }
        : {}),
      env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.log({
      level: "error",
      message: `server failed to start: ${message}`,
      event: "server_start_failed",
    });
    return { exitCode: 1, action: "bind-error" };
  }

  logger.log({
    level: "info",
    message: `listening on ${serverHandle.url}`,
    event: "server_started",
  });

  if (onReady) {
    await onReady({
      close: serverHandle.close,
      host: serverHandle.host,
      port: serverHandle.port,
    });
    return { exitCode: 0, action: "served" };
  }

  await waitForShutdown(serverHandle, logger);
  return { exitCode: 0, action: "served" };
};

const waitForShutdown = (
  serverHandle: {
    close: () => Promise<void>;
  },
  logger: ReturnType<typeof createWorkspaceLogger>,
): Promise<void> =>
  new Promise<void>((resolve) => {
    let shuttingDown = false;
    const onSignal = (signal: NodeJS.Signals): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      logger.log({
        level: "info",
        message: `received ${signal}; draining`,
        event: "server_shutdown_started",
      });
      const hardExit = setTimeout(() => {
        logger.log({
          level: "warn",
          message: `drain budget ${String(SHUTDOWN_GRACE_MS)}ms exceeded`,
          event: "server_shutdown_force",
        });
        resolve();
      }, SHUTDOWN_GRACE_MS);
      hardExit.unref();
      serverHandle
        .close()
        .then(() => {
          clearTimeout(hardExit);
          logger.log({
            level: "info",
            message: "drained",
            event: "server_shutdown_completed",
          });
          resolve();
        })
        .catch((error: unknown) => {
          clearTimeout(hardExit);
          const message =
            error instanceof Error ? error.message : String(error);
          logger.log({
            level: "error",
            message: `drain failed: ${message}`,
            event: "server_shutdown_failed",
          });
          resolve();
        });
    };
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  });

/**
 * True when the module URL matches the realpath-resolved file URL of
 * `entry`. Exported for unit-test coverage of the symlink-aware path.
 *
 * `import.meta.url` (which the production wrapper passes in) is the
 * realpath-resolved file URL Node assigns to the entry module; on
 * systems where the invocation path traverses a symlink (e.g.
 * `/tmp -> /private/tmp` on macOS), the raw `process.argv[1]` form does
 * not match. Realpath-resolve before converting, then percent-encode
 * via {@link pathToFileURL}.
 */
export const isEntryMatchingModuleUrl = ({
  entry,
  moduleUrl,
}: {
  entry: string | undefined;
  moduleUrl: string;
}): boolean => {
  if (entry === undefined) {
    return false;
  }
  let resolved: string;
  try {
    resolved = realpathSync(entry);
  } catch {
    return false;
  }
  return moduleUrl === pathToFileURL(resolved).href;
};

if (
  isEntryMatchingModuleUrl({
    entry: process.argv[1],
    moduleUrl: import.meta.url,
  })
) {
  void runServerEntrypoint({ argv: process.argv.slice(2), env: process.env })
    .then((result) => {
      process.exit(result.exitCode);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`fatal: ${message}\n`);
      process.exit(1);
    });
}
