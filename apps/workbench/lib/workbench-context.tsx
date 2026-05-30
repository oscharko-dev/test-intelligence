"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { INITIAL_RUN, isTerminal, runReducer } from "./run-state";
import {
  SETTINGS_BASELINE,
  diffSettings,
  settingsReducer,
  validateSettings,
  type Settings,
  type SettingsAction,
} from "./settings-state";
import { DEFAULT_FORM, validateForm } from "./runs-form";
import type { RunAction, RunConfig, RunState, ValidationIssue } from "./types";

interface WorkbenchContextValue {
  runState: RunState;
  dispatchRun: (action: RunAction) => void;
  settings: Settings;
  dispatchSettings: (action: SettingsAction) => void;
  discardSettings: () => void;
  importSettingsFromContent: (content: string) => Promise<boolean>;
  importSettingsFromPath: (path: string) => Promise<boolean>;
  saveSettings: () => Promise<boolean>;
  settingsDirty: boolean;
  settingsError: string | null;
  settingsIssues: ValidationIssue[];
  settingsLoaded: boolean;
  settingsSaving: boolean;
  runForm: RunConfig;
  setRunForm: (next: RunConfig | ((prev: RunConfig) => RunConfig)) => void;
  runFormIssues: ValidationIssue[];
  inspectorCollapsed: boolean;
  toggleInspector: () => void;
  setInspectorCollapsed: (next: boolean) => void;
  startRun: (configOverride?: RunConfig) => Promise<void>;
  resetRun: () => void;
  runBusy: boolean;
  runError: string | null;
  lastRunAt: string;
  gatewayState: "ok" | "warn" | "err";
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

interface WorkbenchRunApiResponse {
  run?: RunState;
  error?: {
    code: string;
    message: string;
    issues?: ValidationIssue[];
  };
}

interface WorkbenchSettingsApiResponse {
  settings?: Settings;
  error?: {
    code: string;
    message: string;
  };
}

const readApiResponse = async (
  response: Response,
): Promise<WorkbenchRunApiResponse> => {
  const data = (await response.json().catch(() => ({}))) as unknown;
  if (typeof data !== "object" || data === null) return {};
  return data as WorkbenchRunApiResponse;
};

const messageFromApiResponse = (
  payload: WorkbenchRunApiResponse | WorkbenchSettingsApiResponse,
  fallback: string,
): string => {
  if (payload.error?.message) return payload.error.message;
  return fallback;
};

const readSettingsApiResponse = async (
  response: Response,
): Promise<WorkbenchSettingsApiResponse> => {
  const data = (await response.json().catch(() => ({}))) as unknown;
  if (typeof data !== "object" || data === null) return {};
  return data as WorkbenchSettingsApiResponse;
};

export function WorkbenchProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [runState, dispatchRun] = useReducer(runReducer, INITIAL_RUN);
  const [settings, dispatchSettings] = useReducer(
    settingsReducer,
    SETTINGS_BASELINE,
  );
  const [savedSettings, setSavedSettings] = useState<Settings>({
    ...SETTINGS_BASELINE,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [runForm, setRunForm] = useState<RunConfig>({ ...DEFAULT_FORM });
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const runFormIssues = useMemo(() => validateForm(runForm), [runForm]);
  const settingsDirty = useMemo(
    () => diffSettings(settings, savedSettings).length > 0,
    [settings, savedSettings],
  );
  const settingsIssues = useMemo(
    () =>
      validateSettings(settings, {
        requireFigmaToken: runForm.sourceMode !== "snapshot",
      }),
    [runForm.sourceMode, settings],
  );

  const applyLoadedSettings = useCallback((next: Settings): void => {
    setSavedSettings(next);
    dispatchSettings({ type: "hydrate", values: next });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadSettings = async (): Promise<void> => {
      try {
        const response = await fetch("/api/workbench/settings", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readSettingsApiResponse(response);
        if (!response.ok || payload.settings === undefined) {
          setSettingsError(
            messageFromApiResponse(
              payload,
              "Workbench settings could not be loaded.",
            ),
          );
          return;
        }
        applyLoadedSettings(payload.settings);
        setSettingsError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSettingsError(
          error instanceof Error
            ? error.message
            : "Workbench settings could not be loaded.",
        );
      } finally {
        if (!controller.signal.aborted) setSettingsLoaded(true);
      }
    };
    void loadSettings();
    return () => {
      controller.abort();
    };
  }, [applyLoadedSettings]);

  useEffect(() => {
    if (runState.jobId === null || isTerminal(runState.status)) return;
    const controller = new AbortController();
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(
          `/api/workbench/runs/${encodeURIComponent(runState.jobId ?? "")}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = await readApiResponse(response);
        if (!response.ok) {
          setRunError(
            messageFromApiResponse(payload, "Run status could not be loaded."),
          );
          return;
        }
        if (payload.run !== undefined) {
          dispatchRun({ type: "hydrate", state: payload.run });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setRunError(
          error instanceof Error
            ? error.message
            : "Run status could not be loaded.",
        );
      }
    };
    void poll();
    const t = window.setInterval(() => {
      void poll();
    }, 1500);
    return () => {
      controller.abort();
      window.clearInterval(t);
    };
  }, [runState.jobId, runState.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        setInspectorCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const toggleInspector = useCallback(() => {
    setInspectorCollapsed((c) => !c);
  }, []);

  const saveSettings = useCallback(async (): Promise<boolean> => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/workbench/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const payload = await readSettingsApiResponse(response);
      if (!response.ok || payload.settings === undefined) {
        setSettingsError(
          messageFromApiResponse(
            payload,
            "Workbench settings could not be saved.",
          ),
        );
        return false;
      }
      applyLoadedSettings(payload.settings);
      setSettingsError(null);
      return true;
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Workbench settings could not be saved.",
      );
      return false;
    } finally {
      setSettingsSaving(false);
    }
  }, [applyLoadedSettings, settings]);

  const importSettings = useCallback(
    async (body: { path?: string; content?: string }): Promise<boolean> => {
      setSettingsSaving(true);
      setSettingsError(null);
      try {
        const response = await fetch("/api/workbench/settings/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await readSettingsApiResponse(response);
        if (!response.ok || payload.settings === undefined) {
          setSettingsError(
            messageFromApiResponse(
              payload,
              "Workbench settings could not be imported.",
            ),
          );
          return false;
        }
        applyLoadedSettings(payload.settings);
        setSettingsError(null);
        return true;
      } catch (error) {
        setSettingsError(
          error instanceof Error
            ? error.message
            : "Workbench settings could not be imported.",
        );
        return false;
      } finally {
        setSettingsSaving(false);
      }
    },
    [applyLoadedSettings],
  );

  const importSettingsFromPath = useCallback(
    (envPath: string): Promise<boolean> => importSettings({ path: envPath }),
    [importSettings],
  );

  const importSettingsFromContent = useCallback(
    (content: string): Promise<boolean> => importSettings({ content }),
    [importSettings],
  );

  const discardSettings = useCallback(() => {
    dispatchSettings({ type: "hydrate", values: savedSettings });
    setSettingsError(null);
  }, [savedSettings]);

  const startRun = useCallback(async (configOverride?: RunConfig): Promise<void> => {
    const config = configOverride ?? runForm;
    const configIssues = validateForm(config);
    if (configIssues.length > 0) return;
    const currentSettingsIssues = validateSettings(settings, {
      requireFigmaToken: config.sourceMode !== "snapshot",
    });
    if (currentSettingsIssues.length > 0) {
      setRunError(
        `Workbench runner is not configured. Missing settings: ${currentSettingsIssues.map((issue) => issue.field).join(", ")}.`,
      );
      return;
    }
    if (configOverride !== undefined) {
      setRunForm(configOverride);
    }
    setStartingRun(true);
    setRunError(null);
    try {
      if (settingsDirty) {
        const saved = await saveSettings();
        if (!saved) return;
      }
      const response = await fetch("/api/workbench/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
      const payload = await readApiResponse(response);
      if (!response.ok || payload.run === undefined) {
        setRunError(
          messageFromApiResponse(
            payload,
            "Workbench run could not be started.",
          ),
        );
        return;
      }
      dispatchRun({ type: "hydrate", state: payload.run });
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : "Workbench run could not be started.",
      );
    } finally {
      setStartingRun(false);
    }
  }, [runForm, saveSettings, settings, settingsDirty]);

  const resetRun = useCallback(() => {
    setRunError(null);
    dispatchRun({ type: "reset" });
  }, []);

  const runBusy =
    startingRun || (runState.status !== "idle" && !isTerminal(runState.status));

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      runState,
      dispatchRun,
      settings,
      dispatchSettings,
      discardSettings,
      importSettingsFromContent,
      importSettingsFromPath,
      saveSettings,
      settingsDirty,
      settingsError,
      settingsIssues,
      settingsLoaded,
      settingsSaving,
      runForm,
      setRunForm,
      runFormIssues,
      inspectorCollapsed,
      toggleInspector,
      setInspectorCollapsed,
      startRun,
      resetRun,
      runBusy,
      runError,
      lastRunAt: runState.generatedAt ?? "2026-05-23T14:20:00Z",
      gatewayState:
        runError === null && settingsIssues.length === 0 ? "ok" : "err",
    }),
    [
      runState,
      settings,
      discardSettings,
      importSettingsFromContent,
      importSettingsFromPath,
      saveSettings,
      settingsDirty,
      settingsError,
      settingsIssues,
      settingsLoaded,
      settingsSaving,
      runForm,
      runFormIssues,
      inspectorCollapsed,
      toggleInspector,
      startRun,
      resetRun,
      runBusy,
      runError,
    ],
  );

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
}

export function useWorkbench(): WorkbenchContextValue {
  const v = useContext(WorkbenchContext);
  if (!v) {
    throw new Error("useWorkbench must be used inside WorkbenchProvider");
  }
  return v;
}
