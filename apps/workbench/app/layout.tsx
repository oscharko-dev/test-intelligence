import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { WorkbenchProvider } from "@/lib/workbench-context";
import "./globals.css";

const ui = Inter({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Test Intelligence — Workbench",
  description:
    "Operator workbench for Test Intelligence run drafts and model-gateway settings.",
  icons: {
    icon: "/keiko-logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "hsl(220 13% 8%)",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
      <body>
        <WorkbenchProvider>
          <AppShell>{children}</AppShell>
        </WorkbenchProvider>
      </body>
    </html>
  );
}
