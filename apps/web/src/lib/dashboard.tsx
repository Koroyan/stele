"use client";
/**
 * Dashboard state: the signed-in user, their organizations and the selected organization's
 * chain-mirrored details. Roles shown here come from the chain mirror; the program enforces them.
 */
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { address as toAddress, type Address } from "@solana/kit";
import { findMemberPda, ROLE_ADMIN, ROLE_PUBLISHER } from "@stelehq/protocol";
import { api, ApiError, isReauthError } from "./api";
import { signInWithWallet, type SessionUser } from "./auth";
import { useNetwork, useWallet } from "./wallet";

export interface OrgSummary {
  id: string;
  address: string;
  name: string;
  verifiedDomain: string | null;
  role: "owner" | "member";
  frozen: boolean;
}

export type SigningPolicy =
  "WALLET_ONLY" | "PASSKEY_ONLY" | "WALLET_OR_PASSKEY" | "ACCOUNT_AND_PASSKEY";

export interface OrganizationSettings {
  requireAcceptanceSessions?: boolean;
  allowedRequestDomains?: string[];
  signingPolicy?: SigningPolicy;
  feeSponsor?: "stele" | "organization";
  sponsorFallbackToStele?: boolean;
  sponsorLowBalanceLamports?: number;
  /** Stele products in use: Proof always; Gate when enabled (onboarding or Organization page). */
  products?: { gate?: boolean };
  /** Where gated acceptances are written (default: the wallet's passport). */
  gateStorage?: "passport" | "pass";
}

export interface OrgRow {
  id: string;
  address: string;
  creatorAddress: string;
  name: string;
  ownerAddress: string;
  recoveryAddress: string | null;
  verifiedDomain: string | null;
  domainVerifiedAt: string | null;
  domainExpiresAt: string | null;
  frozen: boolean;
  frozenBy: number;
  settings: OrganizationSettings;
  chainSyncedAt: string | null;
}

export interface MemberRow {
  id: string;
  memberAddress: string;
  roles: number;
  active: boolean;
  compromisedSince: string | null;
  label: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ShardRow {
  id: string;
  address: string;
  shardId: number;
  relayerAddress: string;
  status: "active" | "full" | "retired";
  nextIndex: number;
  relayerIsStele: boolean;
}

export interface DomainRow {
  id: string;
  domain: string;
  status: "pending" | "verified" | "failed" | "revoked" | "expired";
  txtName: string;
  txtValue: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  attestationTx: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export type OrgRole = "owner" | "admin" | "publisher" | "member";

export interface OrgDetail {
  organization: OrgRow;
  role: OrgRole;
  members: MemberRow[];
  shards: ShardRow[];
  domainVerifications: DomainRow[];
  documentCount: number;
  relayer: string;
}

/** What a given wallet may do in the organization, per the program's rules. */
export interface WalletAuthority {
  isOwner: boolean;
  isRecovery: boolean;
  isAdmin: boolean;
  isPublisher: boolean;
  /** Membership account to pass to instructions (null for the owner). */
  membership: Address | null;
  canPublish: boolean;
  canCreateDocument: boolean;
  canManageMembers: boolean;
  canManageShards: boolean;
}

interface DashboardContextValue {
  user: SessionUser;
  recentlyAuthenticated: boolean;
  orgs: OrgSummary[];
  org: OrgSummary | null;
  detail: OrgDetail | null;
  detailError: string | null;
  selectOrg: (id: string) => void;
  reloadOrgs: () => Promise<void>;
  reloadDetail: () => Promise<void>;
  /** Re-signs the sign-in message (step-up) — required for sensitive actions. */
  reauthenticate: () => Promise<void>;
  /** Runs `fn`; if the API demands a recent signature, re-authenticates once and retries. */
  withStepUp: <T>(fn: () => Promise<T>) => Promise<T>;
  authorityOf: (wallet: string | null) => Promise<WalletAuthority | null>;
}

const Ctx = createContext<DashboardContextValue | null>(null);
const STORAGE_KEY = "stele:org";

function readStoredOrg(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeOrg(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage unavailable (private mode): selection is not remembered
  }
}

type Boot =
  | { state: "loading" }
  | { state: "ready"; user: SessionUser; recentlyAuthenticated: boolean; orgs: OrgSummary[] }
  | { state: "error"; message: string };

export function DashboardProvider({
  children,
  fallback,
}: {
  children: (ctx: DashboardContextValue) => ReactNode;
  fallback: (state: Boot) => ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const network = useNetwork();
  const wallet = useWallet();
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await api<{ user: SessionUser; recentlyAuthenticated: boolean }>("/v1/auth/me");
      const { organizations } = await api<{ organizations: OrgSummary[] }>("/v1/organizations");
      setBoot({
        state: "ready",
        user: me.user,
        recentlyAuthenticated: me.recentlyAuthenticated,
        orgs: organizations,
      });
      setSelected((cur) => {
        const pick = cur ?? readStoredOrg();
        return organizations.find((o) => o.id === pick)?.id ?? organizations[0]?.id ?? null;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setBoot({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [pathname, router]);

  // Load once per mount; navigation inside the dashboard keeps the session.
  const [loadOnce] = useState(() => load);
  useEffect(() => {
    void loadOnce();
  }, [loadOnce]);

  const reloadDetail = useCallback(async () => {
    if (!selected) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await api<OrgDetail>(`/v1/organizations/${selected}`));
      setDetailError(null);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e));
    }
  }, [selected]);

  useEffect(() => {
    setDetail(null);
    void reloadDetail();
  }, [reloadDetail]);

  const reauthenticate = useCallback(async () => {
    if (boot.state !== "ready") throw new Error("Not signed in");
    if (!wallet.address) throw new Error("Connect your wallet to confirm this action.");
    if (wallet.address !== boot.user.walletAddress) {
      throw new Error(
        `Connect the wallet you signed in with (${boot.user.walletAddress.slice(0, 4)}…${boot.user.walletAddress.slice(-4)}) to confirm this action.`,
      );
    }
    await signInWithWallet(wallet.address, wallet.signMessage);
    setBoot((b) => (b.state === "ready" ? { ...b, recentlyAuthenticated: true } : b));
  }, [boot, wallet.address, wallet.signMessage]);

  const value = useMemo<DashboardContextValue | null>(() => {
    if (boot.state !== "ready") return null;
    const org = boot.orgs.find((o) => o.id === selected) ?? null;
    return {
      user: boot.user,
      recentlyAuthenticated: boot.recentlyAuthenticated,
      orgs: boot.orgs,
      org,
      detail: detail && detail.organization.id === selected ? detail : null,
      detailError,
      selectOrg: (id: string) => {
        storeOrg(id);
        setSelected(id);
      },
      reloadOrgs: load,
      reloadDetail,
      reauthenticate,
      withStepUp: async <T,>(fn: () => Promise<T>) => {
        try {
          return await fn();
        } catch (e) {
          if (!isReauthError(e)) throw e;
          await reauthenticate();
          return fn();
        }
      },
      authorityOf: async (walletAddress: string | null) => {
        if (!walletAddress || !detail) return null;
        const o = detail.organization;
        const isOwner = o.ownerAddress === walletAddress;
        const m = detail.members.find((x) => x.memberAddress === walletAddress && x.active);
        const isAdmin = !isOwner && Boolean(m && m.roles & ROLE_ADMIN);
        const isPublisher = !isOwner && Boolean(m && m.roles & ROLE_PUBLISHER);
        const membership =
          isOwner || !m
            ? null
            : (
                await findMemberPda(
                  toAddress(o.address),
                  toAddress(walletAddress),
                  toAddress(network.programId),
                )
              )[0];
        return {
          isOwner,
          isRecovery: o.recoveryAddress === walletAddress,
          isAdmin,
          isPublisher,
          membership,
          canPublish: isOwner || isPublisher,
          canCreateDocument: isOwner || isAdmin || isPublisher,
          canManageMembers: isOwner || isAdmin,
          canManageShards: isOwner || isAdmin,
        };
      },
    };
  }, [boot, selected, detail, detailError, load, reloadDetail, reauthenticate, network.programId]);

  if (!value) return <>{fallback(boot)}</>;
  return <Ctx.Provider value={value}>{children(value)}</Ctx.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDashboard must be used inside the dashboard");
  return v;
}

/** The selected organization's details (`null` while loading). */
export function useOrgDetail(): OrgDetail | null {
  return useDashboard().detail;
}
