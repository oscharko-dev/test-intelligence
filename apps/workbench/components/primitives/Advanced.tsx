"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx, ui } from "@/lib/ui-classes";

export interface AdvancedProps {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Advanced({
  title,
  children,
  defaultOpen = false,
}: AdvancedProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={ui.advanced.root} data-open={open}>
      <button
        type="button"
        className={ui.advanced.button}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <ChevronRight
          size={14}
          className={cx(ui.advanced.chev, open && ui.advanced.chevOpen)}
          aria-hidden
          focusable={false}
        />
        <span>{title}</span>
      </button>
      {open && <div className={ui.advanced.body}>{children}</div>}
    </div>
  );
}
