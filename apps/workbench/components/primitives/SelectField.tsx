"use client";

import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx, ui } from "@/lib/ui-classes";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
}

export interface SelectFieldProps<V extends string = string> {
  label: ReactNode;
  value: V;
  onChange: (next: V) => void;
  options: ReadonlyArray<SelectOption<V>>;
  id?: string;
  hint?: ReactNode;
  required?: boolean;
}

export function SelectField<V extends string>({
  label,
  value,
  onChange,
  options,
  id,
  hint,
  required,
}: SelectFieldProps<V>): ReactNode {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className={ui.field.root}>
      <label htmlFor={inputId} className={ui.field.label}>
        <span>
          {label}
          {required && <span className={ui.field.required}> *</span>}
        </span>
      </label>
      <div className={ui.field.selectWrap}>
        <select
          id={inputId}
          className={cx(ui.field.input, ui.field.mono, ui.field.select)}
          value={value}
          onChange={(e) => {
            onChange(e.target.value as V);
          }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className={ui.field.chev}>
          <ChevronDown size={14} aria-hidden focusable={false} />
        </span>
      </div>
      {hint !== undefined && <span className={ui.field.hint}>{hint}</span>}
    </div>
  );
}
