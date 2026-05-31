"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/primitives/Badge";
import { MetadataRow } from "@/components/primitives/MetadataRow";
import { Panel } from "@/components/primitives/Panel";
import type {
  PersistedTestCaseDetail,
  TestCaseLifecycleStatus,
} from "@/lib/server/storage/types";
import { ui } from "@/lib/ui-classes";
import { TestCaseDetailEditor } from "./TestCaseDetailEditor";
import { TestCaseTraceabilityPanel } from "./TestCaseTraceabilityPanel";
import { getTestCaseDetail, type ApiResult } from "./api";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly detail: PersistedTestCaseDetail }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

const LIFECYCLE_VARIANT: Record<TestCaseLifecycleStatus, BadgeVariant> = {
  draft: "neutral",
  reviewed: "info",
  approved: "success",
};

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
  const variant = LIFECYCLE_VARIANT[testCase.status];

  return (
    <div className={ui.screen.root}>
      <header className={ui.screen.head}>
        <BackLink />
      </header>
      <div className="mb-3 flex items-center gap-3">
        <h1 className={ui.screen.title}>{currentVersion.title}</h1>
        <Badge variant={variant}>{testCase.status}</Badge>
      </div>
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
      <TestCaseDetailEditor version={currentVersion} />
      <TestCaseTraceabilityPanel
        traceLinks={currentVersion.traceLinks}
        currentVersionId={currentVersion.id}
      />
    </div>
  );
}
