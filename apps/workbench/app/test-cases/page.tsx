import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TestCasesScreen } from "@/components/test-cases/TestCasesScreen";

export const metadata: Metadata = {
  title: "Test Cases — Test Intelligence — Workbench",
  description:
    "Browse persisted test cases, filter by run or trait, and open a case to inspect its canonical fields and traceability.",
};

export default function TestCasesPage(): ReactNode {
  return <TestCasesScreen />;
}
