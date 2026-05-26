"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { ui } from "@/lib/ui-classes";
import { IconButton } from "./IconButton";

export interface CodeSurfaceProps {
  children: ReactNode;
  raw: string;
  ariaLabel?: string;
}

export function CodeSurface({
  children,
  raw,
  ariaLabel = "Code",
}: CodeSurfaceProps): ReactNode {
  const [copied, setCopied] = useState(false);

  const onCopy = (): void => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(raw).catch(() => {
        /* clipboard may be unavailable; swallow */
      });
    }
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1200);
  };

  return (
    <div className={ui.code.root} role="region" aria-label={ariaLabel}>
      <pre className={ui.code.pre}>{children}</pre>
      <div className={ui.code.copy}>
        <IconButton
          icon={copied ? Check : Copy}
          label={copied ? "Copied" : "Copy"}
          iconSize={14}
          variant="sm"
          onClick={onCopy}
        />
      </div>
    </div>
  );
}
