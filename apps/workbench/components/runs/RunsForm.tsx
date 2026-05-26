"use client";

import {
  useCallback,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AlertTriangle, Command, Copy, Info, Play } from "lucide-react";
import { Advanced } from "@/components/primitives/Advanced";
import { Badge } from "@/components/primitives/Badge";
import { Panel } from "@/components/primitives/Panel";
import { SelectField } from "@/components/primitives/SelectField";
import { Switch } from "@/components/primitives/Switch";
import { TextField } from "@/components/primitives/TextField";
import { OUTPUT_SUBDIR_OPTIONS, buildCli } from "@/lib/runs-form";
import type { OutputSubdir, RunConfig, ValidationIssue } from "@/lib/types";
import { cx, ui } from "@/lib/ui-classes";

export interface RunsFormProps {
  form: RunConfig;
  setForm: (next: RunConfig | ((prev: RunConfig) => RunConfig)) => void;
  issues: ValidationIssue[];
  onSubmit: () => void | Promise<void>;
  submitting?: boolean;
}

export function RunsForm({
  form,
  setForm,
  issues,
  onSubmit,
  submitting = false,
}: RunsFormProps): ReactNode {
  const formRef = useRef<HTMLFormElement>(null);
  const issueByField = useCallback(
    (field: string) => issues.find((i) => i.field === field),
    [issues],
  );

  const setField = useCallback(
    <K extends keyof RunConfig>(key: K) =>
      (value: RunConfig[K]): void => {
        setForm((prev) => ({ ...prev, [key]: value }));
      },
    [setForm],
  );

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void onSubmit();
  };

  const handleKey = (e: KeyboardEvent<HTMLFormElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void onSubmit();
    }
  };

  const copyCli = (): void => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(buildCli(form)).catch(() => {
        /* clipboard may be unavailable; swallow */
      });
    }
  };

  return (
    <form
      ref={formRef}
      className={ui.screen.root}
      onSubmit={handleSubmit}
      onKeyDown={handleKey}
      noValidate
    >
      <div className={ui.screen.head}>
        <h2 className={ui.screen.title}>Configure run</h2>
        <Badge variant="neutral">run draft</Badge>
        <span className={ui.screen.spacer} />
        <span className={ui.screen.meta}>
          <Info size={11} aria-hidden focusable={false} /> local draft only
        </span>
      </div>

      <Panel
        title="Source"
        description="Where the test-intelligence run reads design and requirement context from."
      >
        <TextField
          id="figmaUrl"
          label="Figma URL"
          required
          mono
          value={form.figmaUrl}
          onChange={setField("figmaUrl")}
          placeholder="https://www.figma.com/design/<fileKey>/<name>?node-id=…"
          invalid={Boolean(issueByField("figmaUrl"))}
          {...(issueByField("figmaUrl")
            ? {
                hint: issueByField("figmaUrl")?.message,
                hintVariant: "err" as const,
              }
            : {})}
        />
        <TextField
          id="customContext"
          label="Custom context markdown"
          mono
          value={form.customContext}
          onChange={setField("customContext")}
          placeholder="test-case/<fileKey>/JIRA_STORY.md"
          hint="Workspace-relative path. Optional — appended to the generator context."
        />
      </Panel>

      <Panel
        title="Output"
        description="Where artifacts land on disk and how the run is namespaced inside it."
      >
        <div className={ui.formGrid.twoCol}>
          <div className={ui.formGrid.full}>
            <TextField
              id="outputDir"
              label="Output directory"
              required
              mono
              value={form.outputDir}
              onChange={setField("outputDir")}
              placeholder=".test-intelligence/local-testcases/<batch>"
              invalid={Boolean(issueByField("outputDir"))}
              {...(issueByField("outputDir")
                ? {
                    hint: issueByField("outputDir")?.message,
                    hintVariant: "err" as const,
                  }
                : {})}
            />
          </div>
          <SelectField<OutputSubdir>
            id="outputRunSubdir"
            label="Output run subdir"
            value={form.outputRunSubdir}
            onChange={setField("outputRunSubdir")}
            required
            options={OUTPUT_SUBDIR_OPTIONS}
            hint="Subfolder strategy under the output directory."
          />
        </div>
      </Panel>

      <Panel
        title="Pipeline flags"
        description="Toggles wired directly to the run draft and command preview."
      >
        <Switch
          id="visualSidecar"
          label="Enable visual sidecar"
          sublabel="--enable-visual-sidecar"
          checked={form.visualSidecar}
          onChange={setField("visualSidecar")}
        />
        <Switch
          id="allowPolicyBlocked"
          label="Allow policy-blocked artifacts"
          sublabel="--allow-policy-blocked"
          checked={form.allowPolicyBlocked}
          onChange={setField("allowPolicyBlocked")}
        />
        {form.allowPolicyBlocked && (
          <div className={ui.policyWarning} role="note">
            <AlertTriangle size={14} aria-hidden focusable={false} />
            <span>
              Run will still emit artifacts even if policy gate rejects.
            </span>
          </div>
        )}
      </Panel>

      <Advanced title="Advanced">
        <div className={ui.formGrid.twoCol}>
          <div className={ui.formGrid.full}>
            <TextField
              id="caCerts"
              label="NODE_EXTRA_CA_CERTS path"
              mono
              value={form.caCerts}
              onChange={setField("caCerts")}
              placeholder="/etc/ssl/ws-internal-ca.pem"
              invalid={Boolean(issueByField("caCerts"))}
              hint={
                issueByField("caCerts")?.message ??
                "Forwarded to the Node process as an env var. Absolute path preferred."
              }
              {...(issueByField("caCerts")
                ? { hintVariant: "err" as const }
                : {})}
            />
          </div>
          <div className={ui.formGrid.full}>
            <TextField
              id="jobIdOverride"
              label="Job ID override"
              mono
              value={form.jobIdOverride}
              onChange={setField("jobIdOverride")}
              placeholder="ti-workbench-<epochMs>"
              hint="Leave blank to auto-generate."
            />
          </div>
        </div>
      </Advanced>

      <div className={ui.bottomBar.root}>
        <span className={ui.bottomBar.hint}>
          <Command size={11} aria-hidden focusable={false} />
          <span className={ui.kbd}>⌘</span>
          <span className={ui.kbd}>↵</span>
          <span>to launch</span>
        </span>
        <span className={ui.bottomBar.spacer} />
        <button
          type="button"
          className={ui.button.base}
          onClick={copyCli}
        >
          <Copy size={14} aria-hidden focusable={false} /> Copy expert command
        </button>
        <button
          type="submit"
          className={cx(ui.button.base, ui.button.primary)}
          disabled={issues.length > 0 || submitting}
        >
          <Play size={14} aria-hidden focusable={false} />{" "}
          {submitting ? "Launching" : "Launch run"}
        </button>
      </div>
    </form>
  );
}
