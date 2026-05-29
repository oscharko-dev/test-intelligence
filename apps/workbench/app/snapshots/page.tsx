import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SnapshotVaultScreen } from "@/components/snapshots/SnapshotVaultScreen";

export const metadata: Metadata = {
  title: "Snapshot Vault — Test Intelligence — Workbench",
  description:
    "Import, browse, scope, and launch runs from local Figma Snapshot Vault evidence.",
};

export default function SnapshotVaultPage(): ReactNode {
  return <SnapshotVaultScreen />;
}
