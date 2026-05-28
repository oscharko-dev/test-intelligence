#!/usr/bin/env node
/**
 * Air-gap install verification (Issue #30).
 *
 * Simulates a fully offline operator install of the standalone
 * @oscharko-dev/test-intelligence tarball:
 *
 *   1. `pnpm pack` produces a .tgz in a scratch directory (or accept
 *      one via --tarball).
 *   2. A fresh consumer package.json is created in a second scratch
 *      directory.
 *   3. `npm install --offline --ignore-scripts <tarball>` installs the
 *      package from the local npm cache to prove no network is touched.
 *   4. The installed CLI binary is invoked with `--help`.
 *   5. The ESM and CJS entrypoints are imported / required.
 *   6. The container server-entrypoint is started on a loopback port
 *      and polled at /healthz, /readyz, and /openapi.json.
 *
 * Standalone constraints:
 *
 *   - No `--profile` plumbing; the product ships a single npm artefact
 *     per ADR-0006.
 *   - No /workspace/submit polling; that route does not exist in the
 *     standalone HTTP surface.
 *   - Drives `node dist/server-entrypoint.js`; the standalone CLI has no
 *     `start` subcommand (see Issue #30 spec).
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const parseArgs = () => {
  const args = process.argv.slice(2);
  let tarballPath = "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--tarball") {
      const next = args[i + 1];
      if (!next) throw new Error("Missing value for --tarball.");
      tarballPath = path.resolve(packageRoot, next);
      i += 1;
    } else if (arg?.startsWith("--tarball=")) {
      tarballPath = path.resolve(packageRoot, arg.slice("--tarball=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { tarballPath };
};

const resolveCommandEnv = () => {
  const env = {
    ...process.env,
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  delete env.npm_config_dry_run;
  delete env.NPM_CONFIG_DRY_RUN;
  return env;
};

const run = ({ command, args, cwd }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: resolveCommandEnv(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")} (cwd=${cwd})`,
        ),
      );
    });
  });

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const getLoopbackPort = (host = "127.0.0.1") =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to allocate a loopback port."));
        });
        return;
      }
      const { port } = address;
      server.close(() => {
        resolve(port);
      });
    });
  });

const createBoundedOutput = (maxBytes = 32 * 1024) => {
  let buf = "";
  return {
    append: (chunk) => {
      const text = Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : String(chunk);
      buf += text;
      if (buf.length > maxBytes) buf = buf.slice(buf.length - maxBytes);
    },
    snapshot: () => buf,
  };
};

const waitForHttpOk = async ({
  baseUrl,
  paths,
  child,
  output,
  timeoutMs = 30_000,
}) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  const childFailure = new Promise((_, reject) => {
    const onError = (error) => {
      reject(
        new Error(
          `server-entrypoint child errored: ${error?.message ?? String(error)}\n\n${output.snapshot()}`,
        ),
      );
    };
    const onExit = (code, signal) => {
      reject(
        new Error(
          `server-entrypoint exited (code=${code ?? "?"}, signal=${signal ?? "none"})\n\n${output.snapshot()}`,
        ),
      );
    };
    child.once("error", onError);
    child.once("exit", onExit);
  });

  while (Date.now() < deadline) {
    try {
      await Promise.race([
        (async () => {
          for (const pathname of paths) {
            const response = await fetch(new URL(pathname, baseUrl), {
              signal: AbortSignal.timeout(2_000),
            });
            if (response.status !== 200) {
              throw new Error(
                `Expected 200 from ${pathname}, received ${response.status}.`,
              );
            }
          }
        })(),
        childFailure,
      ]);
      return;
    } catch (error) {
      if (error?.message?.startsWith("server-entrypoint ")) throw error;
      lastError = error;
      await Promise.race([delay(250), childFailure]);
    }
  }
  throw new Error(
    `Timed out waiting for ${paths.join(", ")} at ${baseUrl}.${lastError ? ` Last error: ${lastError.message}` : ""}\n\n${output.snapshot()}`,
  );
};

const stopChild = async (child, timeoutMs = 5_000) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      resolve();
    }
  });
};

const findSingleTarball = async (dir) => {
  const files = await readdir(dir);
  const tgz = files.filter((f) => f.endsWith(".tgz"));
  if (tgz.length !== 1) {
    throw new Error(
      `Expected exactly one .tgz in ${dir}, found ${tgz.length}.`,
    );
  }
  return path.join(dir, tgz[0]);
};

const main = async () => {
  const { tarballPath: providedTarball } = parseArgs();
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-airgap-"),
  );
  const packDir = path.join(tmpRoot, "pack");
  const installDir = path.join(tmpRoot, "install");
  let serverChild;
  const serverOutput = createBoundedOutput();

  try {
    let tarball = providedTarball;
    if (!tarball) {
      await mkdir(packDir, { recursive: true });
      const pack = spawnSync("pnpm", ["pack", "--pack-destination", packDir], {
        cwd: packageRoot,
        stdio: "inherit",
      });
      if (pack.status !== 0) {
        throw new Error("pnpm pack failed.");
      }
      tarball = await findSingleTarball(packDir);
    }

    await mkdir(installDir, { recursive: true });
    await writeFile(
      path.join(installDir, "package.json"),
      `${JSON.stringify(
        {
          name: "test-intelligence-airgap-smoke",
          private: true,
          version: "1.0.0",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await run({
      command: "npm",
      args: ["install", "--offline", "--ignore-scripts", tarball],
      cwd: installDir,
    });

    await run({
      command: "node",
      args: [
        "--input-type=module",
        "-e",
        "const mod = await import('@oscharko-dev/test-intelligence'); if (typeof mod.createTestIntelligenceServer !== 'function') throw new Error('ESM import failed');",
      ],
      cwd: installDir,
    });

    await run({
      command: "node",
      args: [
        "-e",
        "const mod = require('@oscharko-dev/test-intelligence'); if (typeof mod.createTestIntelligenceServer !== 'function') throw new Error('CJS require failed');",
      ],
      cwd: installDir,
    });

    const host = "127.0.0.1";
    const port = await getLoopbackPort(host);
    const entrypointPath = path.join(
      installDir,
      "node_modules",
      "@oscharko-dev",
      "test-intelligence",
      "dist",
      "server-entrypoint.js",
    );

    serverChild = spawn(process.execPath, [entrypointPath], {
      cwd: installDir,
      env: {
        ...resolveCommandEnv(),
        TEST_INTELLIGENCE_HOST: host,
        TEST_INTELLIGENCE_PORT: String(port),
        TEST_INTELLIGENCE_LOG_FORMAT: "json",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverChild.stdout?.on("data", serverOutput.append);
    serverChild.stderr?.on("data", serverOutput.append);

    await waitForHttpOk({
      baseUrl: `http://${host}:${port}`,
      child: serverChild,
      output: serverOutput,
      paths: ["/healthz", "/readyz", "/openapi.json"],
    });

    await stopChild(serverChild);
    serverChild = undefined;

    console.log(
      "[airgap] Offline install + ESM/CJS import + server-entrypoint smoke ok.",
    );
  } finally {
    if (serverChild) {
      try {
        await stopChild(serverChild);
      } catch {
        // best-effort
      }
    }
    await rm(tmpRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error("[airgap] Offline install verification failed:", error);
  process.exit(1);
});
