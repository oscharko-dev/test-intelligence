"use client";

import { useId, type ReactNode } from "react";
import { ui } from "@/lib/ui-classes";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  sublabel?: ReactNode;
  id?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  sublabel,
  id,
}: SwitchProps): ReactNode {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className={ui.switch.row}>
      <label htmlFor={inputId} className={ui.switch.main}>
        <span className={ui.switch.title}>{label}</span>
        {sublabel !== undefined && (
          <span className={ui.switch.sub}>{sublabel}</span>
        )}
      </label>
      <button
        type="button"
        id={inputId}
        role="switch"
        aria-checked={checked}
        className={ui.switch.control}
        onClick={() => {
          onChange(!checked);
        }}
      />
    </div>
  );
}
