"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx, ui } from "@/lib/ui-classes";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  label: string;
  iconSize?: number;
  variant?: "default" | "sm" | "ghost-border";
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      icon: IconComponent,
      label,
      iconSize = 16,
      variant = "default",
      pressed,
      className,
      type = "button",
      ...rest
    },
    ref,
  ): ReactNode {
    const variantClass =
      variant === "sm"
        ? ui.iconButton.sm
        : variant === "ghost-border"
          ? ui.iconButton.ghostBorder
          : null;
    return (
      <button
        ref={ref}
        type={type}
        className={cx(ui.iconButton.base, variantClass, className)}
        aria-label={label}
        title={label}
        aria-pressed={pressed}
        {...rest}
      >
        <IconComponent size={iconSize} aria-hidden focusable={false} />
      </button>
    );
  },
);
