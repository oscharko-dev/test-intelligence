"use client";

import { useId, type ReactNode } from "react";
import { cx, ui } from "@/lib/ui-classes";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  sublabel?: ReactNode;
  id?: string;
  disabled?: boolean;
}

export function Switch({
  checked,
  onChange,
  label,
  sublabel,
  id,
  disabled = false,
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
        aria-disabled={disabled ? true : undefined}
        disabled={disabled}
        className={cx(ui.switch.control, disabled && ui.switch.disabled)}
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
      />
    </div>
  );
}
