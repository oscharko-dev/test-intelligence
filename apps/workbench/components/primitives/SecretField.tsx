"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { IconButton } from "./IconButton";
import { TextField } from "./TextField";

export interface SecretFieldProps {
  label: ReactNode;
  envName?: string;
  required?: boolean;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  id?: string;
}

export function SecretField({
  label,
  envName,
  required,
  value,
  onChange,
  placeholder,
  id,
}: SecretFieldProps): ReactNode {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = (): void => {
    if (value && navigator.clipboard) {
      void navigator.clipboard.writeText(value).catch(() => {
        /* clipboard may be unavailable; swallow */
      });
    }
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1200);
  };

  return (
    <TextField
      {...(id !== undefined ? { id } : {})}
      label={label}
      {...(envName !== undefined ? { envName } : {})}
      {...(required !== undefined ? { required } : {})}
      value={value}
      onChange={onChange}
      {...(placeholder !== undefined ? { placeholder } : {})}
      type={revealed ? "text" : "password"}
      mono
      rightSlot={
        <>
          <IconButton
            icon={revealed ? EyeOff : Eye}
            label={revealed ? "Hide value" : "Reveal value"}
            iconSize={14}
            variant="sm"
            onClick={() => {
              setRevealed((v) => !v);
            }}
          />
          <IconButton
            icon={copied ? Check : Copy}
            label={copied ? "Copied" : "Copy value"}
            iconSize={14}
            variant="sm"
            onClick={onCopy}
          />
        </>
      }
    />
  );
}
