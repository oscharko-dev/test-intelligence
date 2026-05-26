import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default function RootPage(): ReactNode {
  redirect("/runs");
}
