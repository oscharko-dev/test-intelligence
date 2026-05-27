"use client";

import { useCallback, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { DEFAULT_FORM } from "@/lib/runs-form";
import { cx, ui } from "@/lib/ui-classes";
import { useWorkbench } from "@/lib/workbench-context";
import { CredentialSetupPanel } from "@/components/settings/CredentialSetupPanel";
import { RunDetail } from "./RunDetail";
import { RunsForm } from "./RunsForm";
import { SeedHint } from "./SeedHint";

export function RunsScreen(): ReactNode {
  const {
    runState,
    runForm,
    setRunForm,
    runFormIssues,
    startRun,
    resetRun,
    runBusy,
    runError,
    settingsIssues,
  } = useWorkbench();

  const launch = useCallback(async (): Promise<void> => {
    if (runFormIssues.length > 0) return;
    await startRun();
  }, [runFormIssues, startRun]);

  const seedDemo = useCallback((): void => {
    setRunForm((f) => ({
      ...f,
      figmaUrl:
        "https://www.figma.com/design/xr6NfWtzAj4mAk54ZsBs53/Test-View-05?node-id=1-63838&t=0diOJFAvEoq3E8yn-0",
      outputDir: ".test-intelligence/local-testcases/2026-05-24-test-view-05",
      customContext: "test-case/xr6NfWtzAj4mAk54ZsBs53/JIRA_STORY.md",
    }));
  }, [setRunForm]);

  const resetForm = useCallback((): void => {
    setRunForm({ ...DEFAULT_FORM });
  }, [setRunForm]);

  if (runState.status === "idle") {
    return (
      <>
        <RunsForm
          form={runForm}
          setForm={setRunForm}
          issues={runFormIssues}
          onSubmit={launch}
          launchDisabled={settingsIssues.length > 0}
          submitting={runBusy}
        />
        {settingsIssues.length > 0 && (
          <div className="mx-auto max-w-[980px]">
            <CredentialSetupPanel issues={settingsIssues} showManualLink />
          </div>
        )}
        {runError !== null && (
          <div
            role="alert"
            className={cx(ui.policyWarning, "mx-auto max-w-[980px]")}
          >
            <AlertTriangle size={14} aria-hidden focusable={false} />
            <span>{runError}</span>
          </div>
        )}
        <SeedHint hasValues={Boolean(runForm.figmaUrl)} onSeed={seedDemo} />
        <span aria-live="polite" className="sr-only">
          {runState.status === "idle"
            ? ""
            : `Run is ${runState.status as string}`}
        </span>
      </>
    );
  }

  return (
    <RunDetail
      run={runState}
      onNewRun={() => {
        resetRun();
        resetForm();
      }}
    />
  );
}
