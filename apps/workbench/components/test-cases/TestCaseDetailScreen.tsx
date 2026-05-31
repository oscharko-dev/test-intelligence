"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Panel } from "@/components/primitives/Panel";
import { MetadataRow } from "@/components/primitives/MetadataRow";
import type {
  PersistedTestCaseDetail,
  TestCaseVersionRecord,
} from "@/lib/server/storage/types";
import { ui } from "@/lib/ui-classes";
import { TestCaseDetailEditor } from "./TestCaseDetailEditor";
import { TestCaseStatusControl } from "./TestCaseStatusControl";
import { TestCaseTraceabilityPanel } from "./TestCaseTraceabilityPanel";
import { TestCaseVersionHistory } from "./TestCaseVersionHistory";
import { getTestCaseDetail, getTestCaseVersion, type ApiResult } from "./api";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly detail: PersistedTestCaseDetail }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

const fromResult = (result: ApiResult<PersistedTestCaseDetail>): LoadState => {
  if (result.ok) return { kind: "ready", detail: result.value };
  if (result.error.status === 404) return { kind: "missing" };
  return { kind: "error", message: result.error.message };
};

function BackLink(): ReactNode {
  return (
    <Link
      href="/test-cases"
      className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg-default"
    >
      <ArrowLeft size={14} aria-hidden focusable={false} />
      Back to all test cases
    </Link>
  );
}

export interface TestCaseDetailScreenProps {
  readonly caseId: string;
}

export function TestCaseDetailScreen({
  caseId,
}: TestCaseDetailScreenProps): ReactNode {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [selectedVersion, setSelectedVersion] =
    useState<TestCaseVersionRecord | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getTestCaseDetail(caseId);
      if (cancelled) return;
      setState(fromResult(result));
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const handleSaved = useCallback((detail: PersistedTestCaseDetail): void => {
    setState({ kind: "ready", detail });
    setSelectedVersionId(null);
    setSelectedVersion(null);
    // Bump the key so TestCaseVersionHistory remounts and re-fetches.
    setHistoryKey((k) => k + 1);
  }, []);

  const handleTransition = useCallback(
    (detail: PersistedTestCaseDetail): void => {
      setState({ kind: "ready", detail });
    },
    [],
  );

  const handleSelectVersion = useCallback(
    async (versionId: string, currentVersionId: string): Promise<void> => {
      if (versionId === currentVersionId) {
        setSelectedVersionId(null);
        setSelectedVersion(null);
        return;
      }
      setSelectedVersionId(versionId);
      // Optimistically show loading until the version record arrives.
      const result = await getTestCaseVersion(caseId, versionId);
      if (result.ok) {
        setSelectedVersion(result.value);
      }
    },
    [caseId],
  );

  if (state.kind === "loading") {
    return (
      <div className={ui.screen.root}>
        <header className={ui.screen.head}>
          <BackLink />
        </header>
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-dashed border-border-subtle p-6 text-center font-mono text-xs text-fg-muted"
        >
          Loading test case…
        </div>
      </div>
    );
  }

  if (state.kind === "missing") {
    return (
      <div className={ui.screen.root}>
        <header className={ui.screen.head}>
          <BackLink />
        </header>
        <div
          role="status"
          className="rounded-md border border-dashed border-border-subtle p-6 text-center font-mono text-xs text-fg-muted"
        >
          Test case not found.
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={ui.screen.root}>
        <header className={ui.screen.head}>
          <BackLink />
        </header>
        <div
          role="alert"
          className="rounded-md border border-[hsl(0_50%_30%)] bg-[hsl(0_50%_12%_/_0.4)] p-3 font-mono text-xs text-danger"
        >
          {state.message}
        </div>
      </div>
    );
  }

  const { testCase, currentVersion } = state.detail;

  // The version shown in the editor: selected older version or current.
  const displayVersion: TestCaseVersionRecord =
    selectedVersionId !== null && selectedVersion !== null
      ? selectedVersion
      : currentVersion;

  const isCurrentVersion =
    selectedVersionId === null || selectedVersionId === currentVersion.id;

  return (
    <div className={ui.screen.root}>
      <header className={ui.screen.head}>
        <BackLink />
      </header>
      <h1 className={ui.screen.title}>{currentVersion.title}</h1>

      <Panel title="Identity">
        <MetadataRow label="Source run id" value={testCase.sourceRunId} />
        <MetadataRow
          label="Source generated seed id"
          value={testCase.sourceGeneratedSeedId}
        />
        <MetadataRow
          label="Source test case id"
          value={testCase.sourceTestCaseId}
        />
        <MetadataRow label="Created at" value={testCase.createdAt} />
        <MetadataRow label="Updated at" value={testCase.updatedAt} />
      </Panel>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
        <div className="grid gap-3">
          <TestCaseDetailEditor
            key={displayVersion.id}
            version={displayVersion}
            caseId={caseId}
            isCurrentVersion={isCurrentVersion}
            onSaved={handleSaved}
          />
          <TestCaseTraceabilityPanel
            traceLinks={displayVersion.traceLinks}
            currentVersionId={displayVersion.id}
          />
        </div>

        <div className="grid auto-rows-min gap-3">
          <TestCaseStatusControl
            status={testCase.status}
            caseId={caseId}
            onTransition={handleTransition}
          />
          <TestCaseVersionHistory
            key={historyKey}
            caseId={caseId}
            currentVersionId={currentVersion.id}
            {...(selectedVersionId !== null ? { selectedVersionId } : {})}
            onSelectVersion={(versionId) => {
              void handleSelectVersion(versionId, currentVersion.id);
            }}
          />
        </div>
      </div>
    </div>
  );
}
