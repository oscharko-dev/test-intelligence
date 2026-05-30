/**
 * Next.js instrumentation hook. Runs once per server process at startup.
 *
 * WHY the Node-runtime guard and dynamic import: the Workbench storage bootstrap
 * pulls in `better-sqlite3`, a native module that loads only in the Node.js
 * runtime. The guard prevents the Edge runtime from importing it, and the
 * dynamic `import()` keeps the native module out of any non-Node bundle.
 *
 * A bootstrap failure must NOT crash server boot: it is logged as a clear
 * operator message so the server still starts and the failure is diagnosable.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { getWorkbenchStorage } =
      await import("./lib/server/storage/bootstrap");
    // Prime the `globalThis` singleton at startup. Calling
    // `bootstrapWorkbenchStorage()` here would open a connection that is
    // never recorded in the cache, so the next `getWorkbenchStorage()` from
    // a Route Handler / Server Action would open a second connection to the
    // same SQLite file.
    getWorkbenchStorage();
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "unknown bootstrap error";
    console.error(
      `[workbench] Local storage bootstrap failed; persistence features are unavailable: ${detail}`,
    );
  }
}
