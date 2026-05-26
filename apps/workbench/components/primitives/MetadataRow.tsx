import type { ReactNode } from "react";
import { cx, ui } from "@/lib/ui-classes";

export interface MetadataRowProps {
  label: ReactNode;
  value: ReactNode;
  muted?: boolean;
}

export function MetadataRow({
  label,
  value,
  muted,
}: MetadataRowProps): ReactNode {
  return (
    <div className={ui.metadata.row}>
      <span className={ui.metadata.label}>{label}</span>
      <span className={cx(ui.metadata.value, muted && ui.metadata.muted)}>
        {value}
      </span>
    </div>
  );
}
