"use client";

import { useId, type HTMLInputTypeAttribute, type ReactNode } from "react";
import { cx, ui } from "@/lib/ui-classes";

export interface TextFieldProps {
  label: ReactNode;
  envName?: string;
  required?: boolean;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
  hint?: ReactNode;
  hintVariant?: "warn" | "err";
  invalid?: boolean;
  type?: HTMLInputTypeAttribute;
  id?: string;
  rightSlot?: ReactNode;
  describedBy?: string;
}

export function TextField({
  label,
  envName,
  required,
  value,
  onChange,
  placeholder,
  mono = false,
  hint,
  hintVariant,
  invalid,
  type = "text",
  id,
  rightSlot,
  describedBy,
}: TextFieldProps): ReactNode {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const ariaDescribedBy =
    [hint !== undefined ? hintId : null, describedBy ?? null]
      .filter((x): x is string => x !== null)
      .join(" ") || undefined;

  return (
    <div className={ui.field.root}>
      <label htmlFor={inputId} className={ui.field.label}>
        <span>
          {label}
          {required && <span className={ui.field.required}> *</span>}
        </span>
        {envName !== undefined && (
          <span className={ui.field.envName}>{envName}</span>
        )}
      </label>
      <div className={ui.field.inputWrap}>
        <input
          id={inputId}
          type={type}
          className={cx(
            ui.field.input,
            mono && ui.field.mono,
            invalid && ui.field.invalid,
            rightSlot !== undefined && ui.field.hasRightSlot,
          )}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={ariaDescribedBy}
          spellCheck={false}
          autoComplete="off"
        />
        {rightSlot !== undefined && (
          <div className={ui.field.rightSlot}>{rightSlot}</div>
        )}
      </div>
      {hint !== undefined && (
        <span
          id={hintId}
          className={cx(
            ui.field.hint,
            hintVariant === "warn" && ui.field.hintWarn,
            hintVariant === "err" && ui.field.hintErr,
          )}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
