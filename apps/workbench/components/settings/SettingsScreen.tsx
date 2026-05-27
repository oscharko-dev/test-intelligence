"use client";

import { Check, Download, Lock } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/primitives/Badge";
import { Panel } from "@/components/primitives/Panel";
import { SecretField } from "@/components/primitives/SecretField";
import { Switch } from "@/components/primitives/Switch";
import { TextField } from "@/components/primitives/TextField";
import {
  SETTINGS_GROUPS,
  exportEnv,
  validateSettings,
  type SettingsKey,
} from "@/lib/settings-state";
import { cx, ui } from "@/lib/ui-classes";
import { useWorkbench } from "@/lib/workbench-context";
import { CredentialSetupPanel } from "./CredentialSetupPanel";

export function SettingsScreen(): ReactNode {
  const {
    settings,
    dispatchSettings,
    discardSettings,
    saveSettings,
    settingsDirty,
    settingsError,
    settingsLoaded,
    settingsSaving,
  } = useWorkbench();
  const [notice, setNotice] = useState<string | null>(null);
  const issues = useMemo(() => validateSettings(settings), [settings]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void saveSettings().then((ok) => {
      setNotice(ok ? "Settings saved locally." : null);
    });
  };

  const exportFile = (): void => {
    const env = exportEnv(settings);
    if (typeof document === "undefined") return;
    const blob = new Blob([env], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "test-intelligence.env";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <form className={ui.screen.root} onSubmit={handleSubmit}>
      <div className={ui.screen.head}>
        <h2 className={ui.screen.title}>Model gateway settings</h2>
        <Badge variant="neutral">.env-backed</Badge>
        {!settingsLoaded && <Badge variant="neutral">loading</Badge>}
        {issues.length > 0 && <Badge variant="danger">required</Badge>}
        {settingsDirty && <Badge variant="warn">unsaved</Badge>}
        <span className={ui.screen.spacer} />
        <span className={ui.screen.meta}>local persisted values</span>
      </div>

      {(issues.length > 0 || settingsError !== null) && (
        <CredentialSetupPanel issues={issues} />
      )}

      {notice !== null && settingsError === null && (
        <div className="rounded-md border border-[hsl(142_40%_26%)] bg-[hsl(142_40%_10%_/_0.45)] px-2.5 py-2 font-mono text-[11px] text-success">
          {notice}
        </div>
      )}

      {SETTINGS_GROUPS.map((g) => (
        <Panel key={g.id} title={g.title} description={g.description}>
          <div className={ui.formGrid.twoCol}>
            {g.fields.map((f) => {
              const v = settings[f.env];
              if (f.kind === "switch") {
                return (
                  <div className={ui.formGrid.full} key={f.env}>
                    <Switch
                      id={f.env}
                      label={f.label}
                      sublabel={f.env}
                      checked={Boolean(v)}
                      onChange={(nv) => {
                        dispatchSettings({
                          type: "set",
                          key: f.env,
                          value: nv,
                        });
                      }}
                    />
                    {f.helper !== undefined && (
                      <span className={cx(ui.field.hint, "mt-1 block")}>
                        {f.helper}
                      </span>
                    )}
                  </div>
                );
              }
              if (f.kind === "secret") {
                return (
                  <div className={ui.formGrid.full} key={f.env}>
                    <SecretField
                      id={f.env}
                      label={f.label}
                      envName={f.env}
                      required={Boolean(f.required)}
                      value={typeof v === "string" ? v : ""}
                      onChange={(nv) => {
                        dispatchSettings({
                          type: "set",
                          key: f.env as SettingsKey,
                          value: nv,
                        });
                      }}
                      {...(f.placeholder !== undefined
                        ? { placeholder: f.placeholder }
                        : {})}
                      {...(f.helper !== undefined ? { hint: f.helper } : {})}
                    />
                  </div>
                );
              }
              return (
                <div className={ui.formGrid.full} key={f.env}>
                  <TextField
                    id={f.env}
                    label={f.label}
                    envName={f.env}
                    required={Boolean(f.required)}
                    value={typeof v === "string" ? v : ""}
                    onChange={(nv) => {
                      dispatchSettings({
                        type: "set",
                        key: f.env as SettingsKey,
                        value: nv,
                      });
                    }}
                    {...(f.placeholder !== undefined
                      ? { placeholder: f.placeholder }
                      : {})}
                    {...(f.helper !== undefined ? { hint: f.helper } : {})}
                  />
                </div>
              );
            })}
          </div>
        </Panel>
      ))}

      <div className={ui.bottomBar.root}>
        <span className={ui.bottomBar.hint}>
          <Lock size={11} aria-hidden focusable={false} /> export downloads a
          local file only
        </span>
        <span className={ui.bottomBar.spacer} />
        <button
          type="button"
          className={cx(ui.button.base, ui.button.ghost)}
          disabled={!settingsDirty}
          onClick={() => {
            discardSettings();
            setNotice(null);
          }}
        >
          Discard changes
        </button>
        <button type="button" className={ui.button.base} onClick={exportFile}>
          <Download size={14} aria-hidden focusable={false} /> Export as .env
        </button>
        <button
          type="submit"
          className={cx(ui.button.base, ui.button.primary)}
          disabled={!settingsDirty || settingsSaving}
        >
          <Check size={14} aria-hidden focusable={false} />{" "}
          {settingsSaving ? "Saving" : "Save"}
        </button>
      </div>
    </form>
  );
}
