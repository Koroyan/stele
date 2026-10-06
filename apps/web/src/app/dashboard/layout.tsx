import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/shell";
import { NetworkBoundary } from "@/components/network-boundary";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Stele Dashboard" },
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <NetworkBoundary>
      <DashboardShell>{children}</DashboardShell>
    </NetworkBoundary>
  );
}
