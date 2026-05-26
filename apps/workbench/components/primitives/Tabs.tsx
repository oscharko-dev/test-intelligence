"use client";

import {
  useCallback,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ui } from "@/lib/ui-classes";

export interface TabSpec<Id extends string = string> {
  id: Id;
  label: ReactNode;
  count?: number;
}

export interface TabsProps<Id extends string = string> {
  tabs: ReadonlyArray<TabSpec<Id>>;
  value: Id;
  onChange: (next: Id) => void;
  idBase?: string;
  ariaLabel?: string;
}

export function Tabs<Id extends string>({
  tabs,
  value,
  onChange,
  idBase,
  ariaLabel = "Inspector tabs",
}: TabsProps<Id>): ReactNode {
  const generated = useId();
  const id = idBase ?? generated;
  const buttonRefs = useRef<Map<Id, HTMLButtonElement | null>>(new Map());

  const setButtonRef = useCallback(
    (tabId: Id) => (el: HTMLButtonElement | null) => {
      buttonRefs.current.set(tabId, el);
    },
    [],
  );

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = tabs.findIndex((x) => x.id === value);
    if (idx < 0) return;
    const len = tabs.length;
    const nextIdx =
      e.key === "ArrowRight" ? (idx + 1) % len : (idx - 1 + len) % len;
    const next = tabs[nextIdx];
    if (!next) return;
    onChange(next.id);
    buttonRefs.current.get(next.id)?.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className={ui.tabs.root}>
      {tabs.map((t) => {
        const selected = value === t.id;
        return (
          <button
            key={t.id}
            ref={setButtonRef(t.id)}
            type="button"
            role="tab"
            id={`${id}-tab-${t.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={ui.tabs.button}
            onClick={() => {
              onChange(t.id);
            }}
            onKeyDown={handleKey}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className={ui.tabs.count}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
