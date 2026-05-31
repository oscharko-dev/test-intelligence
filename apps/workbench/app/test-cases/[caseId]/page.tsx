import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TestCaseDetailScreen } from "@/components/test-cases/TestCaseDetailScreen";

export const metadata: Metadata = {
  title: "Test Case — Test Intelligence — Workbench",
  description:
    "Inspect a persisted test case: canonical fields, current version, and traceability links.",
};

interface PageProps {
  readonly params: Promise<{ caseId: string }>;
}

export default async function TestCaseDetailPage({
  params,
}: PageProps): Promise<ReactNode> {
  const { caseId } = await params;
  return <TestCaseDetailScreen caseId={caseId} />;
}
