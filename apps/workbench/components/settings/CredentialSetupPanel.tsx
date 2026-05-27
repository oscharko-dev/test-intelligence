"use client";

import { Download, FileInput, Upload } from "lucide-react";
import { useState, type ChangeEvent, type ReactNode } from "react";
import { Panel } from "@/components/primitives/Panel";
import { TextField } from "@/components/primitives/TextField";
import type { ValidationIssue } from "@/lib/types";
import { ui } from "@/lib/ui-classes";
import { useWorkbench } from "@/lib/workbench-context";

interface CredentialSetupPanelProps {
  readonly issues: readonly ValidationIssue[];
  readonly showManualLink?: boolean;
}

export function CredentialSetupPanel({
  issues,
  showManualLink = false,
}: CredentialSetupPanelProps): ReactNode {
  const {
    importSettingsFromContent,
    importSettingsFromPath,
    settingsError,
    settingsSaving,
  } = useWorkbench();
  const [importPath, setImportPath] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const importFromPath = (): void => {
    const envPath = importPath.trim();
    if (envPath.length === 0) return;
    void importSettingsFromPath(envPath).then((ok) => {
      setNotice(ok ? "Settings imported and saved locally." : null);
    });
  };

  const importFromFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    void file.text().then((content) => {
      void importSettingsFromContent(content).then((ok) => {
        setNotice(ok ? "Settings imported and saved locally." : null);
      });
    });
  };

  return (
    <Panel
      title="Credential setup"
      description="Import an environment file or complete the required fields manually. Saved values are stored only in the local Workbench runtime directory."
    >
      {settingsError !== null && (
        <div className={ui.policyWarning} role="alert">
          <span>{settingsError}</span>
        </div>
      )}
      {notice !== null && settingsError === null && (
        <div className="mb-3 rounded-md border border-[hsl(142_40%_26%)] bg-[hsl(142_40%_10%_/_0.45)] px-2.5 py-2 font-mono text-[11px] text-success">
          {notice}
        </div>
      )}
      {issues.length > 0 && (
        <ol className="mb-3 grid gap-1 font-mono text-[11px] text-warn">
          {issues.map((issue) => (
            <li key={`${issue.field}-${issue.message}`}>
              {issue.field}: {issue.message}
            </li>
          ))}
        </ol>
      )}
      <div className={ui.formGrid.twoCol}>
        <div className={ui.formGrid.full}>
          <TextField
            id="envImportPath"
            label=".env path"
            mono
            value={importPath}
            onChange={setImportPath}
            placeholder=".env.local"
            hint="Workspace-local path read by the Workbench process."
          />
        </div>
        <button
          type="button"
          className={ui.button.base}
          disabled={settingsSaving || importPath.trim().length === 0}
          onClick={importFromPath}
        >
          <FileInput size={14} aria-hidden focusable={false} /> Import path
        </button>
        <label className={ui.button.base}>
          <Upload size={14} aria-hidden focusable={false} /> Upload .env
          <input
            className="sr-only"
            type="file"
            accept=".env,text/plain"
            disabled={settingsSaving}
            onChange={importFromFile}
          />
        </label>
        <a
          className={ui.button.base}
          href="/api/workbench/settings/template"
          download="import.env"
        >
          <Download size={14} aria-hidden focusable={false} /> import.env
        </a>
        {showManualLink && (
          <a className={ui.button.base} href="/settings/model">
            Enter manually
          </a>
        )}
      </div>
    </Panel>
  );
}
