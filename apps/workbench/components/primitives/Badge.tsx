import type { ReactNode } from "react";
import { cx, ui } from "@/lib/ui-classes";

export type BadgeVariant =
  | "neutral"
  | "info"
  | "success"
  | "warn"
  | "danger"
  | "accent";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export function Badge({
  variant = "neutral",
  children,
  className,
}: BadgeProps): ReactNode {
  return (
    <span className={cx(ui.badge.base, ui.badge[variant], className)}>
      {children}
    </span>
  );
}
