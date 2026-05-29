"use client";

import {
  Archive,
  Boxes,
  Braces,
  Database,
  Eye,
  Filter,
  Layers3,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Badge } from "@/components/primitives/Badge";
import { Panel } from "@/components/primitives/Panel";
import { TextField } from "@/components/primitives/TextField";
import { DEFAULT_FORM } from "@/lib/runs-form";
import type {
  SnapshotImportAction,
  WorkbenchSnapshotCatalogRow,
  WorkbenchSnapshotDetail,
  WorkbenchSnapshotImportJob,
  WorkbenchSnapshotNodeSummary,
  WorkbenchSnapshotSelectionPreview,
} from "@/lib/snapshot-vault";
import type { RunConfig, SnapshotRunSelection } from "@/lib/types";
import { cx, ui } from "@/lib/ui-classes";
import { useWorkbench } from "@/lib/workbench-context";

interface ApiError {
  error?: {
    code: string;
    message: string;
  };
}

interface CatalogResponse extends ApiError {
  snapshots?: WorkbenchSnapshotCatalogRow[];
}

interface DetailResponse extends ApiError {
  detail?: WorkbenchSnapshotDetail;
}

interface SearchResponse extends ApiError {
  search?: {
    results: WorkbenchSnapshotNodeSummary[];
  };
}

interface ImportResponse extends ApiError {
  job?: WorkbenchSnapshotImportJob;
}

interface PreviewResponse extends ApiError {
  preview?: WorkbenchSnapshotSelectionPreview;
}

const emptySelection = (): SnapshotRunSelection => ({
  nodeIds: [],
  pageIds: [],
  frameIds: [],
});

const countSelection = (selection: SnapshotRunSelection): number =>
  selection.nodeIds.length + selection.pageIds.length + selection.frameIds.length;

const messageFrom = (payload: ApiError, fallback: string): string =>
  payload.error?.message ?? fallback;

const readJson = async <T,>(response: Response): Promise<T> =>
  (await response.json().catch(() => ({}))) as T;

const shortHash = (value: string): string =>
  value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;

const safeJobSuffix = (snapshotId: string): string =>
  snapshotId.replaceAll(/[^A-Za-z0-9._-]/gu, "-").slice(0, 42);

export function SnapshotVaultScreen(): ReactNode {
  const router = useRouter();
  const { settings, startRun, runBusy, runError } = useWorkbench();
  const [snapshots, setSnapshots] = useState<WorkbenchSnapshotCatalogRow[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    null,
  );
  const [detail, setDetail] = useState<WorkbenchSnapshotDetail | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [searchResults, setSearchResults] = useState<
    WorkbenchSnapshotNodeSummary[]
  >([]);
  const [selectedNode, setSelectedNode] =
    useState<WorkbenchSnapshotNodeSummary | null>(null);
  const [selection, setSelection] =
    useState<SnapshotRunSelection>(emptySelection);
  const [selectionPreview, setSelectionPreview] =
    useState<WorkbenchSnapshotSelectionPreview | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importJob, setImportJob] = useState<WorkbenchSnapshotImportJob | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);

  const selectedSnapshot =
    snapshots.find((snapshot) => snapshot.snapshotId === selectedSnapshotId) ??
    null;

  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/workbench/snapshots", {
        cache: "no-store",
      });
      const payload = await readJson<CatalogResponse>(response);
      if (!response.ok || payload.snapshots === undefined) {
        setCatalogError(messageFrom(payload, "Snapshot catalog failed."));
        return;
      }
      setCatalogError(null);
      setSnapshots(payload.snapshots);
      setSelectedSnapshotId((current) => {
        if (
          current !== null &&
          payload.snapshots?.some((snapshot) => snapshot.snapshotId === current)
        ) {
          return current;
        }
        return payload.snapshots?.[0]?.snapshotId ?? null;
      });
    } catch (error) {
      setCatalogError(
        error instanceof Error ? error.message : "Snapshot catalog failed.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCatalog();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadCatalog]);

  useEffect(() => {
    if (selectedSnapshotId === null) {
      return;
    }
    const controller = new AbortController();
    const loadDetail = async (): Promise<void> => {
      try {
        const response = await fetch(
          `/api/workbench/snapshots/${encodeURIComponent(selectedSnapshotId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await readJson<DetailResponse>(response);
        if (!response.ok || payload.detail === undefined) {
          setDetailError(messageFrom(payload, "Snapshot detail failed."));
          return;
        }
        setDetail(payload.detail);
        setDetailError(null);
        setSearchResults(payload.detail.sampleNodes);
        setSelectedNode(payload.detail.sampleNodes[0] ?? null);
        setSelection(emptySelection());
        setSelectionPreview(null);
        setSelectionError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setDetailError(
          error instanceof Error ? error.message : "Snapshot detail failed.",
        );
      }
    };
    void loadDetail();
    return () => {
      controller.abort();
    };
  }, [selectedSnapshotId]);

  useEffect(() => {
    if (selectedSnapshotId === null) return;
    const q = deferredSearchQuery.trim();
    if (q.length === 0) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const runSearch = async (): Promise<void> => {
        try {
          const params = new URLSearchParams({
            q,
            includeHidden: includeHidden ? "true" : "false",
          });
          const response = await fetch(
            `/api/workbench/snapshots/${encodeURIComponent(
              selectedSnapshotId,
            )}/search?${params.toString()}`,
            { cache: "no-store", signal: controller.signal },
          );
          const payload = await readJson<SearchResponse>(response);
          if (!response.ok || payload.search === undefined) {
            setDetailError(messageFrom(payload, "Snapshot search failed."));
            return;
          }
          setSearchResults(payload.search.results);
          setSelectedNode(payload.search.results[0] ?? null);
          setDetailError(null);
        } catch (error) {
          if (controller.signal.aborted) return;
          setDetailError(
            error instanceof Error ? error.message : "Snapshot search failed.",
          );
        }
      };
      void runSearch();
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [deferredSearchQuery, detail?.sampleNodes, includeHidden, selectedSnapshotId]);

  useEffect(() => {
    if (selectedSnapshotId === null || countSelection(selection) === 0) {
      return;
    }
    const controller = new AbortController();
    const preview = async (): Promise<void> => {
      try {
        const response = await fetch(
          `/api/workbench/snapshots/${encodeURIComponent(
            selectedSnapshotId,
          )}/selection-preview`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(selection),
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = await readJson<PreviewResponse>(response);
        if (!response.ok || payload.preview === undefined) {
          setSelectionError(
            messageFrom(payload, "Snapshot selection preview failed."),
          );
          setSelectionPreview(null);
          return;
        }
        setSelectionPreview(payload.preview);
        setSelectionError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSelectionError(
          error instanceof Error
            ? error.message
            : "Snapshot selection preview failed.",
        );
      }
    };
    void preview();
    return () => {
      controller.abort();
    };
  }, [selectedSnapshotId, selection]);

  useEffect(() => {
    if (
      importJob === null ||
      (importJob.status !== "queued" && importJob.status !== "running")
    ) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      const poll = async (): Promise<void> => {
        try {
          const response = await fetch(
            `/api/workbench/snapshot-imports/${encodeURIComponent(
              importJob.jobId,
            )}`,
            { cache: "no-store", signal: controller.signal },
          );
          const payload = await readJson<ImportResponse>(response);
          if (response.ok && payload.job !== undefined) {
            setImportJob(payload.job);
            if (
              payload.job.status === "completed" ||
              payload.job.status === "failed"
            ) {
              await loadCatalog();
            }
          }
        } catch {
          if (!controller.signal.aborted) {
            setImportError("Snapshot import status could not be refreshed.");
          }
        }
      };
      void poll();
    }, 1500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [importJob, loadCatalog]);

  const startImport = async (action: SnapshotImportAction): Promise<void> => {
    setImportError(null);
    try {
      const response = await fetch("/api/workbench/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, figmaUrl: importUrl, settings }),
      });
      const payload = await readJson<ImportResponse>(response);
      if (!response.ok || payload.job === undefined) {
        setImportError(messageFrom(payload, "Snapshot import could not start."));
        return;
      }
      setImportJob(payload.job);
      setImportUrl("");
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "Snapshot import could not start.",
      );
    }
  };

  const addSelection = (
    kind: keyof SnapshotRunSelection,
    id: string,
  ): void => {
    setSelection((current) => {
      if (current[kind].includes(id)) return current;
      return { ...current, [kind]: [...current[kind], id] };
    });
  };

  const removeSelection = (
    kind: keyof SnapshotRunSelection,
    id: string,
  ): void => {
    setSelection((current) => ({
      ...current,
      [kind]: current[kind].filter((entry) => entry !== id),
    }));
  };

  const launchSelection = async (): Promise<void> => {
    if (selectedSnapshot === null || countSelection(selection) === 0) return;
    const config: RunConfig = {
      ...DEFAULT_FORM,
      sourceMode: "snapshot",
      figmaUrl: "",
      snapshotId: selectedSnapshot.snapshotId,
      snapshotSelection: selection,
      outputDir: `.test-intelligence/local-testcases/${safeJobSuffix(
        selectedSnapshot.snapshotId,
      )}`,
      visualSidecar: false,
      autoJiraStory: false,
    };
    await startRun(config);
    router.push("/runs");
  };

  const visibleSearchResults =
    deferredSearchQuery.trim().length === 0
      ? (detail?.sampleNodes ?? [])
      : searchResults;
  const visibleSelectionPreview =
    countSelection(selection) === 0 ? null : selectionPreview;
  const visibleSelectionError =
    countSelection(selection) === 0 ? null : selectionError;

  return (
    <div className="snapshot-vault min-h-full bg-[radial-gradient(circle_at_10%_0%,hsl(200_80%_16%_/_0.35),transparent_34%),linear-gradient(180deg,hsl(220_13%_9%),hsl(220_13%_7%))] px-4 py-4 md:px-5">
      <div className="mx-auto grid max-w-[1480px] gap-4">
        <SnapshotHero
          count={snapshots.length}
          importJob={importJob}
          onReload={loadCatalog}
        />
        <ImportPanel
          importUrl={importUrl}
          setImportUrl={setImportUrl}
          importJob={importJob}
          importError={importError}
          onImport={() => void startImport("import")}
          onRefresh={() => void startImport("refresh")}
        />
        {(catalogError ?? detailError ?? runError) !== null && (
          <div role="alert" className={cx(ui.policyWarning, "mt-0")}>
            <TriangleAlert size={14} aria-hidden focusable={false} />
            <span>{catalogError ?? detailError ?? runError}</span>
          </div>
        )}
        <div className="grid gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(300px,380px)]">
          <CatalogPanel
            snapshots={snapshots}
            selectedSnapshotId={selectedSnapshotId}
            onSelect={setSelectedSnapshotId}
          />
          <ExplorerPanel
            detail={detail}
            selectedSnapshot={selectedSnapshot}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            includeHidden={includeHidden}
            setIncludeHidden={setIncludeHidden}
            searchResults={visibleSearchResults}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            onAddSelection={addSelection}
          />
          <BasketPanel
            selectedSnapshot={selectedSnapshot}
            selection={selection}
            preview={visibleSelectionPreview}
            error={visibleSelectionError}
            busy={runBusy}
            onRemove={removeSelection}
            onLaunch={() => void launchSelection()}
          />
        </div>
      </div>
    </div>
  );
}

function SnapshotHero({
  count,
  importJob,
  onReload,
}: {
  count: number;
  importJob: WorkbenchSnapshotImportJob | null;
  onReload: () => void | Promise<void>;
}): ReactNode {
  return (
    <section className="overflow-hidden rounded-xl border border-border-subtle bg-[linear-gradient(135deg,hsl(220_13%_13%_/_0.94),hsl(200_65%_11%_/_0.86))] p-4 shadow-[0_22px_80px_hsl(220_40%_4%_/_0.35)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="grid gap-2">
          <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-info">
            <Database size={14} aria-hidden focusable={false} />
            Workbench Snapshot Vault
          </div>
          <h2 className="m-0 max-w-[760px] text-[24px] font-semibold tracking-[-0.03em] text-fg-default md:text-[30px]">
            Inspect local Figma evidence, scope the run, then generate without
            re-entering the source URL.
          </h2>
          <p className="m-0 max-w-[860px] text-sm text-fg-muted">
            Import/refresh is the only live Figma path. Browsing, search,
            preview plans, scope preflight, and run-from-snapshot use validated
            local vault artifacts only.
          </p>
        </div>
        <div className="md:ml-auto grid min-w-[260px] gap-2 rounded-lg border border-border-subtle bg-bg-base/70 p-3 font-mono text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">local snapshots</span>
            <span className="text-fg-default">{count}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">queue state</span>
            <span className="text-fg-default">
              {importJob?.queueState ?? "idle"}
            </span>
          </div>
          <button
            type="button"
            className={cx(ui.button.base, ui.button.ghost, "justify-center")}
            onClick={() => void onReload()}
          >
            <RefreshCw size={13} aria-hidden focusable={false} /> Reload local
            vault
          </button>
        </div>
      </div>
    </section>
  );
}

function ImportPanel({
  importUrl,
  setImportUrl,
  importJob,
  importError,
  onImport,
  onRefresh,
}: {
  importUrl: string;
  setImportUrl: (value: string) => void;
  importJob: WorkbenchSnapshotImportJob | null;
  importError: string | null;
  onImport: () => void;
  onRefresh: () => void;
}): ReactNode {
  const busy = importJob?.status === "queued" || importJob?.status === "running";
  return (
    <Panel
      title="Import / refresh"
      description="Paste a Figma design URL only for the live import action. Workbench stores hashed source identity in status, not the raw URL."
      actions={
        importJob !== null ? (
          <Badge variant="neutral">{importJob.status}</Badge>
        ) : null
      }
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <TextField
          id="snapshot-import-url"
          label="Figma URL for live import"
          value={importUrl}
          onChange={setImportUrl}
          mono
          placeholder="https://www.figma.com/design/<fileKey>/<name>?node-id=…"
          hint="Ephemeral request input. Local vault status uses a source URL digest."
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cx(ui.button.base, ui.button.primary)}
            onClick={onImport}
            disabled={busy || importUrl.trim().length === 0}
          >
            {busy ? <Loader2 size={14} aria-hidden focusable={false} /> : <Archive size={14} aria-hidden focusable={false} />}
            Import snapshot
          </button>
          <button
            type="button"
            className={ui.button.base}
            onClick={onRefresh}
            disabled={busy || importUrl.trim().length === 0}
          >
            <RefreshCw size={14} aria-hidden focusable={false} /> Refresh
          </button>
        </div>
      </div>
      {(importJob ?? importError) !== null && (
        <div
          className={cx(
            "mt-3 grid gap-2 rounded-md border px-3 py-2 font-mono text-[11px]",
            importError !== null || importJob?.status === "failed"
              ? "border-[hsl(0_50%_30%)] bg-[hsl(0_50%_12%_/_0.32)] text-danger"
              : "border-border-subtle bg-bg-input text-fg-muted",
          )}
          role={importError !== null ? "alert" : "status"}
        >
          {importJob !== null && (
            <>
              <span>
                job {importJob.jobId} · source digest{" "}
                {shortHash(importJob.sourceUrlHash)}
              </span>
              <span>
                tenant {importJob.tenantScope} · queue {importJob.queueState}
                {importJob.snapshotId ? ` · snapshot ${importJob.snapshotId}` : ""}
              </span>
              {importJob.rateLimit !== undefined && (
                <span>
                  rate-limit{" "}
                  {importJob.rateLimit.remaining ?? "n/a"} remaining
                  {importJob.rateLimit.retryAfterSeconds !== undefined
                    ? ` · retry after ${importJob.rateLimit.retryAfterSeconds}s`
                    : ""}
                </span>
              )}
              {importJob.message !== undefined && <span>{importJob.message}</span>}
            </>
          )}
          {importError !== null && <span>{importError}</span>}
        </div>
      )}
    </Panel>
  );
}

function CatalogPanel({
  snapshots,
  selectedSnapshotId,
  onSelect,
}: {
  snapshots: WorkbenchSnapshotCatalogRow[];
  selectedSnapshotId: string | null;
  onSelect: (snapshotId: string) => void;
}): ReactNode {
  return (
    <Panel
      title="Local snapshots"
      description="Validated manifests under the active tenant vault."
      className="min-h-[520px]"
    >
      {snapshots.length === 0 ? (
        <div className="grid min-h-[360px] place-items-center rounded-lg border border-dashed border-border-subtle bg-bg-input p-5 text-center">
          <div className="grid gap-2">
            <Boxes className="mx-auto text-fg-subtle" size={30} aria-hidden />
            <p className="m-0 text-sm text-fg-default">No local snapshots yet.</p>
            <p className="m-0 max-w-[260px] text-xs text-fg-muted">
              Import a board or point Workbench at a repo-local Snapshot Vault
              produced by the CLI.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {snapshots.map((snapshot) => {
            const selected = snapshot.snapshotId === selectedSnapshotId;
            return (
              <button
                type="button"
                key={snapshot.snapshotId}
                onClick={() => onSelect(snapshot.snapshotId)}
                className={cx(
                  "grid gap-2 rounded-lg border bg-bg-input p-3 text-left transition-colors hover:border-border-strong",
                  selected
                    ? "border-accent shadow-[inset_0_0_0_1px_hsl(210_100%_60%_/_0.28)]"
                    : "border-border-subtle",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 break-all font-mono text-xs text-fg-default">
                    {snapshot.snapshotId}
                  </span>
              <Badge variant="neutral">
                {snapshot.cacheState}
              </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono text-[11px] text-fg-muted">
                  <span>{snapshot.pageCount} pages</span>
                  <span>{snapshot.frameCount} frames</span>
                  <span>{snapshot.nodeCount} nodes</span>
                </div>
                <span className="font-mono text-[11px] text-fg-subtle">
                  {snapshot.importedAt} · {snapshot.tenantScope}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function ExplorerPanel({
  detail,
  selectedSnapshot,
  searchQuery,
  setSearchQuery,
  includeHidden,
  setIncludeHidden,
  searchResults,
  selectedNode,
  setSelectedNode,
  onAddSelection,
}: {
  detail: WorkbenchSnapshotDetail | null;
  selectedSnapshot: WorkbenchSnapshotCatalogRow | null;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  includeHidden: boolean;
  setIncludeHidden: (value: boolean) => void;
  searchResults: WorkbenchSnapshotNodeSummary[];
  selectedNode: WorkbenchSnapshotNodeSummary | null;
  setSelectedNode: (node: WorkbenchSnapshotNodeSummary) => void;
  onAddSelection: (kind: keyof SnapshotRunSelection, id: string) => void;
}): ReactNode {
  if (detail === null || selectedSnapshot === null) {
    return (
      <Panel title="Board overview" className="min-h-[520px]">
        <div className="grid min-h-[360px] place-items-center text-fg-muted">
          Select or import a snapshot to inspect local evidence.
        </div>
      </Panel>
    );
  }
  return (
    <div className="grid gap-4">
      <Panel
        title="Board overview"
        description="Large-board navigation is summarized from the local node index; it does not call live Figma REST."
        actions={<Badge variant="info">local cache</Badge>}
      >
        <div className="grid gap-3 md:grid-cols-4">
          <Stat label="pages" value={selectedSnapshot.pageCount} />
          <Stat label="frames" value={selectedSnapshot.frameCount} />
          <Stat label="nodes" value={selectedSnapshot.nodeCount} />
          <Stat label="components" value={selectedSnapshot.componentCount} />
        </div>
        <div className="mt-3 grid gap-2 rounded-md border border-border-subtle bg-bg-input p-3 font-mono text-[11px] text-fg-muted md:grid-cols-2">
          <span>lifecycle {selectedSnapshot.lifecycleState}</span>
          <span>preview {selectedSnapshot.previewStatus}</span>
          <span>cache {selectedSnapshot.cacheState}</span>
          <span>
            rate limit{" "}
            {selectedSnapshot.rateLimit.remaining ?? "not reported"}
          </span>
        </div>
      </Panel>
      <PageFrameNavigator
        detail={detail}
        onAddSelection={onAddSelection}
        onSearch={setSearchQuery}
      />
      <Panel
        title="Search / filter"
        description="Search is evaluated server-side against validated node-index metadata."
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <TextField
            id="snapshot-search"
            label="Search local node index"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="IBAN, submit, component, node id…"
            mono
            hint="No live Figma requests. Hidden layers are excluded unless enabled."
          />
          <label className="mb-2 inline-flex items-center gap-2 font-mono text-[11px] text-fg-muted">
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(event) => setIncludeHidden(event.currentTarget.checked)}
            />
            include hidden
          </label>
        </div>
        <div className="mt-3 grid max-h-[330px] gap-2 overflow-auto pr-1">
          {searchResults.length === 0 ? (
            <div className="rounded-md border border-dashed border-border-subtle bg-bg-input p-5 text-center text-xs text-fg-muted">
              No local nodes matched this search.
            </div>
          ) : (
            searchResults.map((node) => (
              <button
                type="button"
                key={`${node.pageId}:${node.nodeId}`}
                onClick={() => setSelectedNode(node)}
                className={cx(
                  "grid gap-1 rounded-md border bg-bg-input px-3 py-2 text-left hover:border-border-strong",
                  selectedNode?.nodeId === node.nodeId
                    ? "border-accent"
                    : "border-border-subtle",
                )}
              >
                <span className="font-ui text-xs font-medium text-fg-default">
                  {node.nodeName}
                </span>
                <span className="font-mono text-[11px] text-fg-muted">
                  {node.pageName}
                  {node.frameName ? ` / ${node.frameName}` : ""} ·{" "}
                  {node.nodeType}
                </span>
                <span className="flex flex-wrap gap-1">
                  {!node.visible && <Badge variant="warn">hidden</Badge>}
                  {node.offCanvas && <Badge variant="warn">off-canvas</Badge>}
                  {node.missingBounds && <Badge variant="neutral">no bounds</Badge>}
                  {node.componentHints.slice(0, 2).map((hint) => (
                    <Badge key={hint} variant="info">
                      {hint}
                    </Badge>
                  ))}
                </span>
              </button>
            ))
          )}
        </div>
      </Panel>
      <PreviewAndInspector
        detail={detail}
        node={selectedNode}
        onAddSelection={onAddSelection}
      />
    </div>
  );
}

function PageFrameNavigator({
  detail,
  onAddSelection,
  onSearch,
}: {
  detail: WorkbenchSnapshotDetail;
  onAddSelection: (kind: keyof SnapshotRunSelection, id: string) => void;
  onSearch: (value: string) => void;
}): ReactNode {
  const [focusedPageId, setFocusedPageId] = useState(
    detail.pages[0]?.pageId ?? "",
  );
  const effectivePageId = detail.pages.some((page) => page.pageId === focusedPageId)
    ? focusedPageId
    : (detail.pages[0]?.pageId ?? "");
  const selectedPage = detail.pages.find((page) => page.pageId === effectivePageId);
  const frames = detail.frames.filter((frame) =>
    effectivePageId.length === 0 ? true : frame.pageId === effectivePageId,
  );
  return (
    <Panel
      title="Pages / frames"
      description="Navigate locally cached screens and add whole pages or frames to the run scope."
      actions={<Badge variant="neutral">{detail.frames.length} frames</Badge>}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
        <div className="grid max-h-[260px] content-start gap-2 overflow-auto pr-1">
          {detail.pages.map((page) => {
            const active = page.pageId === effectivePageId;
            return (
              <div
                key={page.pageId}
                className={cx(
                  "grid gap-2 rounded-md border bg-bg-input p-3",
                  active ? "border-accent" : "border-border-subtle",
                )}
              >
                <button
                  type="button"
                  className="grid gap-1 text-left"
                  onClick={() => {
                    setFocusedPageId(page.pageId);
                    onSearch(page.pageName);
                  }}
                >
                  <span className="font-ui text-xs font-medium text-fg-default">
                    {page.pageName}
                  </span>
                  <span className="break-all font-mono text-[11px] text-fg-muted">
                    {page.pageId} · {page.frameCount} frames · {page.nodeCount} nodes
                  </span>
                </button>
                <button
                  type="button"
                  className={cx(ui.button.base, "justify-center")}
                  onClick={() => onAddSelection("pageIds", page.pageId)}
                >
                  <Braces size={13} aria-hidden focusable={false} /> Add page
                </button>
              </div>
            );
          })}
        </div>
        <div className="grid max-h-[260px] content-start gap-2 overflow-auto pr-1">
          {selectedPage !== undefined && (
            <div className="rounded-md border border-border-subtle bg-bg-base/70 px-3 py-2 font-mono text-[11px] text-fg-muted">
              Showing frames for {selectedPage.pageName}
            </div>
          )}
          {frames.length === 0 ? (
            <div className="rounded-md border border-dashed border-border-subtle bg-bg-input p-5 text-center text-xs text-fg-muted">
              No frames are indexed for the selected page.
            </div>
          ) : (
            frames.map((frame) => (
              <div
                key={`${frame.pageId}:${frame.frameId}`}
                className="grid gap-2 rounded-md border border-border-subtle bg-bg-input p-3"
              >
                <button
                  type="button"
                  className="grid gap-1 text-left"
                  onClick={() => onSearch(frame.frameName)}
                >
                  <span className="font-ui text-xs font-medium text-fg-default">
                    {frame.frameName}
                  </span>
                  <span className="break-all font-mono text-[11px] text-fg-muted">
                    {frame.frameId} · {frame.nodeCount} nodes
                  </span>
                </button>
                <button
                  type="button"
                  className={cx(ui.button.base, "justify-center")}
                  onClick={() => onAddSelection("frameIds", frame.frameId)}
                >
                  <Layers3 size={13} aria-hidden focusable={false} /> Add frame
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </Panel>
  );
}

function PreviewAndInspector({
  detail,
  node,
  onAddSelection,
}: {
  detail: WorkbenchSnapshotDetail;
  node: WorkbenchSnapshotNodeSummary | null;
  onAddSelection: (kind: keyof SnapshotRunSelection, id: string) => void;
}): ReactNode {
  return (
    <Panel
      title="Preview / inspector"
      description="Preview tiles are local bounded preview-plan metadata. Missing imagery falls back to evidence metadata."
      actions={<Badge variant="accent">no live calls</Badge>}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="relative min-h-[280px] overflow-hidden rounded-lg border border-border-subtle bg-[radial-gradient(circle_at_20%_20%,hsl(210_100%_60%_/_0.16),transparent_28%),linear-gradient(135deg,hsl(220_13%_10%),hsl(220_13%_8%))]">
          {detail.previewTiles.length > 0 ? (
            <div className="absolute inset-4">
              {detail.previewTiles.slice(0, 36).map((tile, index) => {
                const left = `${Math.min(88, Math.max(2, (Math.abs(tile.x) % 1000) / 10))}%`;
                const top = `${Math.min(82, Math.max(4, (Math.abs(tile.y) % 700) / 8))}%`;
                const width = `${Math.min(32, Math.max(10, tile.width / 38))}%`;
                const height = `${Math.min(26, Math.max(8, tile.height / 34))}%`;
                return (
                  <span
                    key={tile.tileId}
                    className="absolute rounded border border-[hsl(200_70%_45%_/_0.6)] bg-[hsl(200_80%_24%_/_0.22)] shadow-[0_0_22px_hsl(200_90%_50%_/_0.08)]"
                    style={{ left, top, width, height, zIndex: index + 1 }}
                    title={tile.tileId}
                  />
                );
              })}
            </div>
          ) : (
            <div className="grid h-full min-h-[280px] place-items-center p-6 text-center">
              <div className="grid gap-2">
                <Eye className="mx-auto text-fg-subtle" aria-hidden />
                <p className="m-0 text-sm text-fg-default">
                  No local preview tiles.
                </p>
                <p className="m-0 max-w-[360px] text-xs text-fg-muted">
                  Use node metadata, labels, bounds, and trace anchors until a
                  preview manifest is present.
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="grid content-start gap-3">
          {node === null ? (
            <p className="m-0 text-xs text-fg-muted">
              Select a search result to inspect local evidence.
            </p>
          ) : (
            <>
              <div className="grid gap-1">
                <span className="font-ui text-sm font-semibold text-fg-default">
                  {node.nodeName}
                </span>
                <span className="break-all font-mono text-[11px] text-fg-muted">
                  {node.nodeId}
                </span>
              </div>
              <div className="grid gap-1 font-mono text-[11px] text-fg-muted">
                <span>{node.pageName}</span>
                {node.frameName !== undefined && <span>{node.frameName}</span>}
                <span>{node.nodeType}</span>
                {node.bbox !== undefined && (
                  <span>
                    {Math.round(node.bbox.width)}×{Math.round(node.bbox.height)}
                  </span>
                )}
              </div>
              {node.textSnippet !== undefined && (
                <p className="m-0 rounded border border-border-subtle bg-bg-input p-2 text-xs text-fg-muted">
                  {node.textSnippet}
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                {node.labels.slice(0, 8).map((label) => (
                  <Badge key={label} variant="neutral">
                    {label}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className={cx(ui.button.base, ui.button.primary)}
                  onClick={() => onAddSelection("nodeIds", node.nodeId)}
                >
                  <Filter size={13} aria-hidden focusable={false} /> Add node
                </button>
                {node.frameId !== undefined && (
                  <button
                    type="button"
                    className={ui.button.base}
                    onClick={() => onAddSelection("frameIds", node.frameId!)}
                  >
                    <Layers3 size={13} aria-hidden focusable={false} /> Add frame
                  </button>
                )}
                <button
                  type="button"
                  className={ui.button.base}
                  onClick={() => onAddSelection("pageIds", node.pageId)}
                >
                  <Braces size={13} aria-hidden focusable={false} /> Add page
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function BasketPanel({
  selectedSnapshot,
  selection,
  preview,
  error,
  busy,
  onRemove,
  onLaunch,
}: {
  selectedSnapshot: WorkbenchSnapshotCatalogRow | null;
  selection: SnapshotRunSelection;
  preview: WorkbenchSnapshotSelectionPreview | null;
  error: string | null;
  busy: boolean;
  onRemove: (kind: keyof SnapshotRunSelection, id: string) => void;
  onLaunch: () => void;
}): ReactNode {
  const count = countSelection(selection);
  return (
    <Panel
      title="Scope basket"
      description="The basket is ephemeral and maps directly to runner selection ids."
      className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-96px)] xl:overflow-auto"
      actions={<Badge variant={count > 0 ? "success" : "neutral"}>{count} selected</Badge>}
    >
      <div className="grid gap-3">
        <ScopeGroup
          title="Pages"
          kind="pageIds"
          values={selection.pageIds}
          onRemove={onRemove}
        />
        <ScopeGroup
          title="Frames"
          kind="frameIds"
          values={selection.frameIds}
          onRemove={onRemove}
        />
        <ScopeGroup
          title="Masks / elements / groups"
          kind="nodeIds"
          values={selection.nodeIds}
          onRemove={onRemove}
        />
        <div className="rounded-md border border-border-subtle bg-bg-input p-3 font-mono text-[11px] text-fg-muted">
          {preview !== null ? (
            <div className="grid gap-1">
                <span className="inline-flex items-center gap-1 text-fg-default">
                  <ShieldCheck size={13} aria-hidden /> local preflight matched{" "}
                  {preview.resolvedNodeCount} nodes
                </span>
              <span>payload {preview.payloadBytes} bytes</span>
              <span>scope {shortHash(preview.scopeDigest)}</span>
              <span>anchors {preview.traceAnchors.length}</span>
            </div>
          ) : error !== null ? (
            <span className="text-fg-default">{error}</span>
          ) : (
            <span>
              Add a local page, frame, mask, element or group to compute the
              deterministic run scope.
            </span>
          )}
        </div>
        <button
          type="button"
          className={cx(ui.button.base, ui.button.primary, "justify-center")}
          disabled={
            busy ||
            selectedSnapshot === null ||
            !selectedSnapshot.launchable ||
            count === 0 ||
            preview === null
          }
          onClick={onLaunch}
        >
          {busy ? <Loader2 size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          Generate from selection
        </button>
        <p className="m-0 text-xs text-fg-muted">
          Run-from-snapshot uses the local vault root resolved by the server.
          The browser does not send private paths or raw source URLs.
        </p>
      </div>
    </Panel>
  );
}

function ScopeGroup({
  title,
  kind,
  values,
  onRemove,
}: {
  title: string;
  kind: keyof SnapshotRunSelection;
  values: string[];
  onRemove: (kind: keyof SnapshotRunSelection, id: string) => void;
}): ReactNode {
  return (
    <div className="grid gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-muted">
        {title}
      </span>
      {values.length === 0 ? (
        <span className="rounded border border-dashed border-border-subtle px-2 py-1.5 font-mono text-[11px] text-fg-subtle">
          none
        </span>
      ) : (
        values.map((value) => (
          <span
            key={value}
            className="inline-flex min-w-0 items-center gap-2 rounded border border-border-subtle bg-bg-input px-2 py-1.5 font-mono text-[11px] text-fg-default"
          >
            <span className="min-w-0 flex-1 truncate">{value}</span>
            <button
              type="button"
              className="text-fg-muted hover:text-fg-default"
              aria-label={`Remove ${value}`}
              onClick={() => onRemove(kind, value)}
            >
              <X size={12} aria-hidden focusable={false} />
            </button>
          </span>
        ))
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-input p-3">
      <span className="block font-mono text-[11px] uppercase tracking-[0.08em] text-fg-muted">
        {label}
      </span>
      <span className="font-mono text-lg text-fg-default">{value}</span>
    </div>
  );
}
