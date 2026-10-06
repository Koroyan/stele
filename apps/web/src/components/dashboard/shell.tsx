"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIcon,
  Alert,
  BuildingIcon,
  CreditCardIcon,
  Button,
  Card,
  FileIcon,
  HomeIcon,
  KeyIcon,
  ListIcon,
  PlugIcon,
  ShieldIcon,
  Spinner,
  SteleLogo,
  UsersIcon,
  WalletIcon,
  cn,
} from "@stele/ui";
import { WalletButton } from "@/components/wallet";
import { signOut } from "@/lib/auth";
import { DashboardProvider, useDashboard } from "@/lib/dashboard";
import { shortAddress } from "@/lib/format";
import { NetworkSwitcher } from "@/components/network-switcher";
import { useWallet } from "@/lib/wallet";
import { CreateOrganization } from "./create-organization";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: HomeIcon, exact: true },
  { href: "/dashboard/documents", label: "Documents", icon: FileIcon },
  { href: "/dashboard/acceptances", label: "Acceptances", icon: ActivityIcon },
  { href: "/dashboard/organization", label: "Organization", icon: BuildingIcon },
  { href: "/dashboard/team", label: "Team", icon: UsersIcon },
  { href: "/dashboard/api-keys", label: "API keys", icon: KeyIcon },
  { href: "/dashboard/integrations", label: "Integrations", icon: PlugIcon },
  { href: "/dashboard/signing", label: "Signing & fees", icon: WalletIcon },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCardIcon },
  { href: "/dashboard/security", label: "Security", icon: ShieldIcon },
  { href: "/dashboard/audit-log", label: "Audit log", icon: ListIcon },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { orgs, org, selectOrg, user } = useDashboard();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Stele home">
          <SteleLogo />
        </Link>
      </div>
      <div className="px-3">
        <label htmlFor="org-switch" className="sr-only">
          Organization
        </label>
        <select
          id="org-switch"
          value={org?.id ?? ""}
          onChange={(e) => {
            if (e.target.value === "__new") {
              router.push("/dashboard?new=1");
              onNavigate?.();
            } else selectOrg(e.target.value);
          }}
          className="h-10 w-full truncate rounded-lg border border-line-strong bg-surface-2 px-3 text-[13.5px] font-medium text-fg outline-none focus:border-accent-line"
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.verifiedDomain ? ` — ${o.verifiedDomain}` : ""}
            </option>
          ))}
          <option value="__new">+ New organization</option>
        </select>
      </div>
      <nav aria-label="Dashboard" className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
                active
                  ? "bg-surface-2 text-fg"
                  : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-accent" : "text-fg-subtle")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-3 border-t border-line px-4 py-4">
        <NetworkSwitcher variant="sidebar" />
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[12px] text-fg-muted" title={user.walletAddress}>
            {shortAddress(user.walletAddress, 5, 5)}
          </span>
          <button
            type="button"
            className="text-[12px] text-fg-subtle hover:text-fg"
            onClick={() => {
              void signOut().finally(() => router.replace("/login"));
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function Banners() {
  const { detail, user } = useDashboard();
  const wallet = useWallet();
  const banners: ReactNode[] = [];
  if (detail?.organization.frozen) {
    banners.push(
      <Alert key="frozen" tone="danger" title="This organization is frozen">
        Publishing and new acceptances are paused on-chain.{" "}
        <Link href="/dashboard/security" className="text-accent">
          Review security
        </Link>
      </Alert>,
    );
  }
  if (detail && !detail.shards.some((s) => s.status === "active" && s.relayerIsStele)) {
    banners.push(
      <Alert key="shard" tone="warning" title="Acceptances are not enabled yet">
        Create an acceptance shard so users can sign.{" "}
        <Link href="/dashboard/organization#shards" className="text-accent">
          Enable acceptances
        </Link>
      </Alert>,
    );
  }
  if (wallet.address && wallet.address !== user.walletAddress) {
    banners.push(
      <Alert key="wallet" tone="info">
        Your connected wallet ({shortAddress(wallet.address)}) differs from the account you signed
        in with ({shortAddress(user.walletAddress)}). On-chain actions will be signed by the
        connected wallet.
      </Alert>,
    );
  }
  return banners.length ? <div className="mb-6 space-y-3">{banners}</div> : null;
}

function Shell({ children }: { children: ReactNode }) {
  const { orgs, org } = useDashboard();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const creating = pathname === "/dashboard" && searchParams.get("new") === "1";

  useEffect(() => setMobileOpen(false), [pathname]);

  const showCreate = orgs.length === 0 || creating;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-bg-raised lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-line bg-bg-raised">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <p className="truncate text-[13.5px] font-medium text-fg">
            {showCreate ? "New organization" : (org?.name ?? "")}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/verify"
              className="hidden rounded-md px-3 py-1.5 text-[13px] text-fg-muted hover:text-fg sm:inline-block"
            >
              Verifier
            </Link>
            <WalletButton />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          {showCreate ? (
            <CreateOrganization
              firstTime={orgs.length === 0}
              onCancel={orgs.length > 0 ? () => router.replace("/dashboard") : undefined}
            />
          ) : (
            <>
              <Banners />
              {children}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider
      fallback={(boot) =>
        boot.state === "error" ? (
          <div className="mx-auto max-w-lg px-6 py-24">
            <Card className="p-6">
              <p className="text-[15px] font-semibold text-fg">The dashboard could not load</p>
              <p className="mt-2 text-[13.5px] text-fg-muted">{boot.message}</p>
              <Button className="mt-5" variant="secondary" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </Card>
          </div>
        ) : (
          <div className="flex min-h-dvh items-center justify-center gap-3 text-[14px] text-fg-muted">
            <Spinner className="h-5 w-5 text-accent" /> Loading your organizations…
          </div>
        )
      }
    >
      {() => <Shell>{children}</Shell>}
    </DashboardProvider>
  );
}
