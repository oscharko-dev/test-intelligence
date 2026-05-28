"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { CodeSurface } from "@/components/primitives/CodeSurface";
import { MetadataRow } from "@/components/primitives/MetadataRow";
import { Tabs } from "@/components/primitives/Tabs";
import { buildCli, parseFigmaParts } from "@/lib/runs-form";
import { tokenizeCli } from "@/lib/tokenize-cli";
import type { RunConfig, RunState, ValidationIssue } from "@/lib/types";
import { cx, ui } from "@/lib/ui-classes";
import { useWorkbench } from "@/lib/workbench-context";

type FormTabId = "summary" | "command" | "validation";
type DetailTabId = "summary" | "stages" | "artifacts";

export function RunsInspector(): ReactNode {
  const { runState, runForm, runFormIssues } = useWorkbench();
  if (runState.status === "idle") {
    return <RunsFormInspector form={runForm} issues={runFormIssues} />;
  }
  return <RunsDetailInspector run={runState} />;
}

function RunsFormInspector({
  form,
  issues,
}: {
  form: RunConfig;
  issues: ValidationIssue[];
}): ReactNode {
  const [tab, setTab] = useState<FormTabId>("summary");
  const cli = buildCli(form);
  const { fileKey, nodeId } = parseFigmaParts(form.figmaUrl);
  const flagSummary = [
    `subdir=${form.outputRunSubdir}`,
    `visual=${form.visualSidecar ? "on" : "off"}`,
    `auto-jira=${form.autoJiraStory ? "on" : "off"}`,
    `allow-blocked=${form.allowPolicyBlocked ? "on" : "off"}`,
  ].join(" · ");

  const scrollToField = (id: string): void => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(id);
    if (el instanceof HTMLElement) {
      el.focus({ preventScroll: false });
      el.scrollIntoView({ block: "center" });
    }
  };

  return (
    <>
      <Tabs<FormTabId>
        idBase="runs-insp"
        tabs={[
          { id: "summary", label: "Summary" },
          { id: "command", label: "Expert command" },
          {
            id: "validation",
            label: "Validation",
            ...(issues.length > 0 ? { count: issues.length } : {}),
          },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="py-3">
        {tab === "summary" && (
          <>
            <div className={ui.inspectorGroup.group}>
              <span className={ui.inspectorGroup.title}>Source</span>
              <MetadataRow
                label="fileKey"
                value={fileKey}
                muted={fileKey === "—"}
              />
              <MetadataRow
                label="node-id"
                value={nodeId}
                muted={nodeId === "—"}
              />
              <MetadataRow
                label="custom context"
                value={
                  form.autoJiraStory
                    ? "auto-generated from screenshot"
                    : form.customContext || "—"
                }
                muted={!form.customContext && !form.autoJiraStory}
              />
            </div>
            <div className={ui.inspectorGroup.group}>
              <span className={ui.inspectorGroup.title}>Output target</span>
              <MetadataRow
                label="dir"
                value={form.outputDir || "—"}
                muted={!form.outputDir}
              />
              <MetadataRow label="run subdir" value={form.outputRunSubdir} />
              <MetadataRow
                label="job-id"
                value={form.jobIdOverride || "auto"}
                muted={!form.jobIdOverride}
              />
            </div>
            <div className={ui.inspectorGroup.group}>
              <span className={ui.inspectorGroup.title}>
                Pipeline flags resolved
              </span>
              <MetadataRow label="resolved" value={flagSummary} />
            </div>
            <div className={ui.inspectorGroup.group}>
              <span className={ui.inspectorGroup.title}>
                Estimated artifact set
              </span>
              <MetadataRow
                label="files"
                value={`10  ·  ${form.visualSidecar ? "incl. visual" : "no visual"}`}
              />
              <MetadataRow
                label="manifests"
                value="evidence-seal · genealogy · topology"
              />
            </div>
          </>
        )}
        {tab === "command" && (
          <CodeSurface raw={cli} ariaLabel="Generated expert command">
            {tokenizeCli(cli)}
          </CodeSurface>
        )}
        {tab === "validation" && (
          <>
            {issues.length === 0 ? (
              <ul className={ui.validation.list}>
                <li className={cx(ui.validation.item, ui.validation.okItem)}>
                  <span className={ui.validation.success}>
                    <Check size={14} aria-hidden focusable={false} /> Form
                    passes all checks.
                  </span>
                </li>
              </ul>
            ) : (
              <ol className={ui.validation.list}>
                {issues.map((i, idx) => (
                  <li key={`${i.field}-${idx}`} className={ui.validation.item}>
                    <div>
                      <div>
                        <button
                          type="button"
                          className={ui.validation.fieldAnchor}
                          onClick={() => {
                            scrollToField(i.field);
                          }}
                        >
                          {i.label}
                        </button>
                      </div>
                      <div className={ui.validation.message}>{i.message}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </>
  );
}

function RunsDetailInspector({ run }: { run: RunState }): ReactNode {
  const [tab, setTab] = useState<DetailTabId>("summary");
  return (
    <>
      <Tabs<DetailTabId>
        idBase="rundet-insp"
        tabs={[
          { id: "summary", label: "Summary" },
          { id: "stages", label: "Stages" },
          { id: "artifacts", label: "Artifacts", count: run.artifacts.length },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="py-3">
        {tab === "summary" && (
          <>
            <div className={ui.inspectorGroup.group}>
              <span className={ui.inspectorGroup.title}>Run</span>
              <MetadataRow label="jobId" value={run.jobId ?? "—"} />
              <MetadataRow label="status" value={run.status} />
              <MetadataRow
                label="generatedAt"
                value={
                  run.generatedAt
                    ? run.generatedAt.replace("T", " ").slice(0, 19) + "Z"
                    : "—"
                }
              />
              <MetadataRow label="contract" value={run.contractVersion} />
            </div>
            <div className={ui.inspectorGroup.group}>
              <span className={ui.inspectorGroup.title}>Source</span>
              <MetadataRow
                label="figma"
                value={
                  run.config ? run.config.figmaUrl.slice(0, 38) + "…" : "—"
                }
              />
              <MetadataRow
                label="output"
                value={run.config?.outputDir ?? "—"}
              />
            </div>
          </>
        )}
        {tab === "stages" && (
          <div className={ui.inspectorGroup.group}>
            {(
              ["generator", "judge", "visual_sidecar", "policy_gate"] as const
            ).map((s) => (
              <MetadataRow
                key={s}
                label={s}
                value={`${run.stages[s].successes}/${run.stages[s].attempts} · ${run.stages[s].outcome}`}
              />
            ))}
          </div>
        )}
        {tab === "artifacts" && (
          <div>
            {run.artifacts.map((a) => {
              const cls =
                a.status === "ok"
                  ? ui.inspectorGroup.artifactOk
                  : a.status === "pending"
                    ? ui.inspectorGroup.artifactPending
                    : ui.inspectorGroup.artifactErr;
              return (
                <div key={a.name} className={ui.inspectorGroup.artifact}>
                  <span className={ui.inspectorGroup.artifactName}>
                    {a.name}
                  </span>
                  <span className={cx(ui.inspectorGroup.artifactStatus, cls)}>
                    {a.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
