/**
 * Stele as a customer of itself: the organization that publishes Stele's Terms of Service and
 * Privacy Policy (STELE_PLATFORM_ORGANIZATION), whether a dashboard user accepted the current Terms
 * — an ordinary Stele acceptance, recorded on-chain — Stele's staff, and the contact inbox.
 */
import {
  acceptances,
  and,
  contactRequests,
  count,
  desc,
  documents,
  documentVersions,
  eq,
  gte,
  organizations,
} from "@stele/db";
import type { Deps } from "../deps.js";
import { ApiError, notFound } from "../errors.js";

export const TERMS_SLUG = "terms-of-service";
export const PRIVACY_SLUG = "privacy-policy";

export interface PlatformDocument {
  slug: string;
  address: string;
  version: { number: number; label: string; title: string; address: string } | null;
}

/** Stele's own organization and its legal documents, or null when not configured. */
export async function platformDocuments(
  deps: Deps,
): Promise<{
  organization: string;
  terms: PlatformDocument | null;
  privacy: PlatformDocument | null;
} | null> {
  const address = deps.config.STELE_PLATFORM_ORGANIZATION;
  if (!address) return null;
  const [org] = await deps.db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.address, address));
  if (!org) return null;
  const docs = await deps.db
    .select({ doc: documents, version: documentVersions })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.address, documents.currentVersionAddress))
    .where(eq(documents.organizationId, org.id));
  const pick = (slug: string): PlatformDocument | null => {
    const row = docs.find((d) => d.doc.slug === slug);
    if (!row) return null;
    return {
      slug,
      address: row.doc.address,
      version: row.version
        ? {
            number: row.version.number,
            label: row.version.versionLabel,
            title: row.version.title,
            address: row.version.address,
          }
        : null,
    };
  };
  return { organization: address, terms: pick(TERMS_SLUG), privacy: pick(PRIVACY_SLUG) };
}

export interface TermsStatus {
  organization: string;
  document: string;
  version: { number: number; label: string; title: string; address: string };
  accepted: boolean;
  /** The latest version this wallet accepted, when it is not the current one. */
  acceptedVersion: number | null;
}

/**
 * Whether `wallet` accepted the current version of Stele's Terms. Null when Stele publishes no
 * Terms on this deployment (then nothing is required).
 */
export async function termsStatus(deps: Deps, wallet: string): Promise<TermsStatus | null> {
  const platform = await platformDocuments(deps);
  const terms = platform?.terms;
  if (!platform || !terms?.version) return null;
  const [latest] = await deps.db
    .select({ versionNumber: acceptances.versionNumber })
    .from(acceptances)
    .innerJoin(documents, eq(documents.id, acceptances.documentId))
    .where(and(eq(documents.address, terms.address), eq(acceptances.signerAddress, wallet)))
    .orderBy(desc(acceptances.versionNumber))
    .limit(1);
  const accepted = (latest?.versionNumber ?? 0) >= terms.version.number;
  return {
    organization: platform.organization,
    document: terms.slug,
    version: terms.version,
    accepted,
    acceptedVersion: accepted ? null : (latest?.versionNumber ?? null),
  };
}

export const isPlatformAdmin = (deps: Deps, wallet: string) =>
  deps.config.STELE_PLATFORM_ADMINS.includes(wallet);

export function requirePlatformAdmin(deps: Deps, wallet: string): void {
  if (!isPlatformAdmin(deps, wallet)) throw new ApiError(403, "forbidden", "Stele staff only");
}

// ---- contact inbox ---------------------------------------------------------------------------------

export const CONTACT_TOPICS = [
  "partnership",
  "integration",
  "enterprise",
  "press",
  "other",
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export interface ContactInput {
  topic: ContactTopic;
  name: string;
  email: string;
  company?: string | null;
  website?: string | null;
  message: string;
}

/** Messages everyone together may send per day (per IP: STELE_CONTACT_PER_IP_HOUR). */
const PER_DAY = 500;

export async function submitContact(deps: Deps, input: ContactInput, ipHash: string) {
  const hourAgo = new Date(Date.now() - 3_600_000);
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [mine] = await deps.db
    .select({ n: count() })
    .from(contactRequests)
    .where(and(eq(contactRequests.ipHash, ipHash), gte(contactRequests.createdAt, hourAgo)));
  const [all] = await deps.db
    .select({ n: count() })
    .from(contactRequests)
    .where(gte(contactRequests.createdAt, dayAgo));
  if ((mine?.n ?? 0) >= deps.config.STELE_CONTACT_PER_IP_HOUR || (all?.n ?? 0) >= PER_DAY)
    throw new ApiError(429, "rate_limited", "Too many messages for now. Please try again later.");
  const [row] = await deps.db
    .insert(contactRequests)
    .values({
      topic: input.topic,
      name: input.name.trim(),
      email: input.email.trim(),
      company: input.company?.trim() || null,
      website: input.website?.trim() || null,
      message: input.message.trim(),
      ipHash,
    })
    .returning({ id: contactRequests.id });
  deps.logger.info({ contactRequest: row!.id, topic: input.topic }, "contact request received");
  return { id: row!.id };
}

export async function listContact(deps: Deps, status?: string) {
  const rows = await deps.db
    .select({
      id: contactRequests.id,
      topic: contactRequests.topic,
      name: contactRequests.name,
      email: contactRequests.email,
      company: contactRequests.company,
      website: contactRequests.website,
      message: contactRequests.message,
      status: contactRequests.status,
      note: contactRequests.note,
      createdAt: contactRequests.createdAt,
      updatedAt: contactRequests.updatedAt,
    })
    .from(contactRequests)
    .where(status ? eq(contactRequests.status, status as never) : undefined)
    .orderBy(desc(contactRequests.createdAt))
    .limit(500);
  const counts = await deps.db
    .select({ status: contactRequests.status, n: count() })
    .from(contactRequests)
    .groupBy(contactRequests.status);
  return {
    requests: rows,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
  };
}

export async function updateContact(
  deps: Deps,
  id: string,
  patch: { status?: "new" | "read" | "replied" | "archived"; note?: string | null },
) {
  const [row] = await deps.db
    .update(contactRequests)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(contactRequests.id, id))
    .returning({
      id: contactRequests.id,
      status: contactRequests.status,
      note: contactRequests.note,
    });
  if (!row) throw notFound("Message");
  return { request: row };
}
