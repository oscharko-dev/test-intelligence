"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cx, ui } from "@/lib/ui-classes";

export interface SeedHintProps {
  hasValues: boolean;
  onSeed: () => void;
}

export function SeedHint({ hasValues, onSeed }: SeedHintProps): ReactNode {
  if (hasValues) return null;
  return (
    <div className={ui.seedHint}>
      <Info size={12} aria-hidden focusable={false} />
      <span>Empty form — fill required fields or seed with a demo config.</span>
      <span className={ui.seedSpacer} />
      <button
        className={cx(ui.button.base, ui.button.ghost)}
        type="button"
        onClick={onSeed}
      >
        Seed demo
      </button>
    </div>
  );
}
