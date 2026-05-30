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

const describeErrorKind = (error: Error): string => {
  const code =
    "code" in error && typeof error.code === "string" ? `:${error.code}` : "";
  return `${error.name}${code}`;
};

const describeStartupError = (error: unknown): string => {
  if (!(error instanceof Error)) return "unknown startup error";
  const cause =
    "cause" in error && error.cause instanceof Error
      ? ` cause=${describeErrorKind(error.cause)}`
      : "";
  return `${describeErrorKind(error)}${cause}`;
};

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
    console.error(
      `[workbench] Local storage bootstrap failed; persistence features are unavailable: ${describeStartupError(error)}`,
    );
    return;
  }
  // Best-effort #54 legacy index. Runs AFTER the storage singleton is primed so
  // the indexer's adapter writes land on the same root. WHY a separate try: an
  // indexing failure must NOT trip the outer bootstrap-failed catch — the
  // application still boots without legacy backfill.
  try {
    const { ensureLegacyIndexAtStartup } =
      await import("./lib/server/workbench-legacy-indexer");
    await ensureLegacyIndexAtStartup();
  } catch (error) {
    const detail =
      error instanceof Error ? error.name : "unknown legacy-index error";
    console.error(
      `[workbench] Legacy artifact index skipped at startup: ${detail}`,
    );
  }
}
