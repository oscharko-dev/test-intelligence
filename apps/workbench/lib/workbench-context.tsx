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
  isSettingsDirty,
  settingsReducer,
  type Settings,
  type SettingsAction,
} from "./settings-state";
import { DEFAULT_FORM, validateForm } from "./runs-form";
import type {
  RunAction,
  RunConfig,
  RunState,
  ValidationIssue,
} from "./types";

interface WorkbenchContextValue {
  runState: RunState;
  dispatchRun: (action: RunAction) => void;
  settings: Settings;
  dispatchSettings: (action: SettingsAction) => void;
  settingsDirty: boolean;
  runForm: RunConfig;
  setRunForm: (next: RunConfig | ((prev: RunConfig) => RunConfig)) => void;
  runFormIssues: ValidationIssue[];
  inspectorCollapsed: boolean;
  toggleInspector: () => void;
  setInspectorCollapsed: (next: boolean) => void;
  startRun: () => Promise<void>;
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

const readApiResponse = async (
  response: Response,
): Promise<WorkbenchRunApiResponse> => {
  const data = (await response.json().catch(() => ({}))) as unknown;
  if (typeof data !== "object" || data === null) return {};
  return data as WorkbenchRunApiResponse;
};

const messageFromApiResponse = (
  payload: WorkbenchRunApiResponse,
  fallback: string,
): string => {
  if (payload.error?.message) return payload.error.message;
  return fallback;
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
  const [runForm, setRunForm] = useState<RunConfig>({ ...DEFAULT_FORM });
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const runFormIssues = useMemo(() => validateForm(runForm), [runForm]);
  const settingsDirty = useMemo(() => isSettingsDirty(settings), [settings]);

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

  const startRun = useCallback(async (): Promise<void> => {
    if (runFormIssues.length > 0) return;
    setStartingRun(true);
    setRunError(null);
    try {
      const response = await fetch("/api/workbench/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runForm),
      });
      const payload = await readApiResponse(response);
      if (!response.ok || payload.run === undefined) {
        setRunError(
          messageFromApiResponse(payload, "Workbench run could not be started."),
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
  }, [runForm, runFormIssues]);

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
      settingsDirty,
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
      gatewayState: runError === null ? "ok" : "err",
    }),
    [
      runState,
      settings,
      settingsDirty,
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
