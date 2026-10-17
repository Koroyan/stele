/**
 * Organization analytics for the dashboard's Insights page: how many people accepted, how they
 * signed, how many finished once asked, how long it took, who still has to accept the current
 * version, where acceptances came from (site and time zone — never IPs), what it cost, and what the
 * Gate saw. Everything is read from the index of on-chain evidence and the challenge log.
 *
 * A "person" is the organization's own user ID (externalUserRef) when it linked one, otherwise the
 * signing key — the same rule the re-acceptance list uses.
 */
import {
  acceptanceChallenges,
  acceptances,
  accessPasses,
  and,
  desc,
  documents,
  documentVersions,
  eq,
  gatePolicies,
  gte,
  inArray,
  isNotNull,
  lt,
  proofs,
  sql,
} from "@stele/db";
import type { Deps } from "../deps.js";

export interface AnalyticsQuery {
  days: number;
  documentId?: string;
}

const person = sql<string>`coalesce(${acceptances.externalUserRef}, ${acceptances.signerAddress})`;
const utcDay = (col: unknown) =>
  sql<string>`to_char(date_trunc('day', ${col} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

function rangeOf(days: number, now = new Date()) {
  const to = now;
  const from = new Date(to.getTime() - days * 86_400_000);
  const previousFrom = new Date(from.getTime() - days * 86_400_000);
  return { from, to, previousFrom };
}

export async function organizationAnalytics(deps: Deps, organizationId: string, q: AnalyticsQuery) {
  const { from, to, previousFrom } = rangeOf(q.days);
  const db = deps.db;
  const inOrg = (extra: ReturnType<typeof and>[] = []) =>
    and(
      eq(acceptances.organizationId, organizationId),
      ...(q.documentId ? [eq(acceptances.documentId, q.documentId)] : []),
      ...extra,
    );
  const between = (a: Date, b: Date) =>
    and(gte(acceptances.createdAt, a), lt(acceptances.createdAt, b));
  const challengeScope = (a: Date, b: Date) =>
    and(
      eq(acceptanceChallenges.organizationId, organizationId),
      ...(q.documentId ? [eq(acceptanceChallenges.documentId, q.documentId)] : []),
      gte(acceptanceChallenges.createdAt, a),
      lt(acceptanceChallenges.createdAt, b),
    );

  // ---- headline numbers, this period and the previous one -----------------------------------------
  const totalsFor = async (a: Date, b: Date) => {
    const [t] = await db
      .select({
        acceptances: sql<number>`count(*)::int`,
        people: sql<number>`count(distinct ${person})::int`,
        feeLamports: sql<number>`coalesce(sum(${acceptances.feeLamports}), 0)::bigint`,
      })
      .from(acceptances)
      .where(inOrg([between(a, b)]));
    const statuses = await db
      .select({ status: acceptanceChallenges.status, n: sql<number>`count(*)::int` })
      .from(acceptanceChallenges)
      .where(challengeScope(a, b))
      .groupBy(acceptanceChallenges.status);
    const count = (s: string[]) =>
      statuses.filter((r) => s.includes(r.status)).reduce((x, r) => x + r.n, 0);
    const requested = count(["issued", "submitted", "confirmed", "finalized", "failed", "expired"]);
    const recorded = count(["confirmed", "finalized"]);
    return {
      acceptances: t?.acceptances ?? 0,
      people: t?.people ?? 0,
      feeLamports: Number(t?.feeLamports ?? 0),
      funnel: {
        requested,
        signed: count(["submitted", "confirmed", "finalized"]),
        recorded,
        finalized: count(["finalized"]),
        expired: count(["expired"]),
        failed: count(["failed"]),
      },
      completionRate: requested > 0 ? recorded / requested : null,
    };
  };
  const [current, previous] = await Promise.all([
    totalsFor(from, to),
    totalsFor(previousFrom, from),
  ]);

  // Median time from the request to the record on Solana (the person reading and signing).
  const [timing] = await db
    .select({
      median: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from (${acceptances.createdAt} - ${acceptanceChallenges.createdAt})))`,
    })
    .from(acceptances)
    .innerJoin(acceptanceChallenges, eq(acceptanceChallenges.id, acceptances.challengeId))
    .where(inOrg([between(from, to)]));

  // ---- daily acceptances by signing method ------------------------------------------------------------
  const dailyRows = await db
    .select({
      day: utcDay(acceptances.createdAt),
      type: acceptances.signerType,
      n: sql<number>`count(*)::int`,
    })
    .from(acceptances)
    .where(inOrg([between(from, to)]))
    .groupBy(utcDay(acceptances.createdAt), acceptances.signerType);
  const daily: { date: string; wallet: number; passkey: number }[] = [];
  for (let i = q.days - 1; i >= 0; i--) {
    const date = new Date(to.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const rows = dailyRows.filter((r) => r.day === date);
    daily.push({
      date,
      wallet: rows.filter((r) => r.type === "wallet").reduce((x, r) => x + r.n, 0),
      passkey: rows.filter((r) => r.type !== "wallet").reduce((x, r) => x + r.n, 0),
    });
  }

  // ---- when people sign (their local hour) and where they are (time zone) -----------------------------
  const localHour = sql<number>`extract(hour from ((${acceptances.createdAt} AT TIME ZONE 'UTC') + make_interval(mins => ${acceptanceChallenges.signerUtcOffsetMinutes})))::int`;
  const hourRows = await db
    .select({ hour: localHour, n: sql<number>`count(*)::int` })
    .from(acceptances)
    .innerJoin(acceptanceChallenges, eq(acceptanceChallenges.id, acceptances.challengeId))
    .where(inOrg([between(from, to), isNotNull(acceptanceChallenges.signerUtcOffsetMinutes)]))
    .groupBy(localHour);
  const hours = Array.from({ length: 24 }, (_, h) => hourRows.find((r) => r.hour === h)?.n ?? 0);

  const zoneRows = await db
    .select({ zone: acceptanceChallenges.signerTimeZone, n: sql<number>`count(*)::int` })
    .from(acceptances)
    .innerJoin(acceptanceChallenges, eq(acceptanceChallenges.id, acceptances.challengeId))
    .where(inOrg([between(from, to), isNotNull(acceptanceChallenges.signerTimeZone)]))
    .groupBy(acceptanceChallenges.signerTimeZone)
    .orderBy(desc(sql`count(*)`));

  const domainRows = await db
    .select({ domain: acceptances.requestDomain, n: sql<number>`count(*)::int` })
    .from(acceptances)
    .where(inOrg([between(from, to)]))
    .groupBy(acceptances.requestDomain)
    .orderBy(desc(sql`count(*)`));

  const failureRows = await db
    .select({ reason: acceptanceChallenges.failureReason, n: sql<number>`count(*)::int` })
    .from(acceptanceChallenges)
    .where(and(challengeScope(from, to), isNotNull(acceptanceChallenges.failureReason)))
    .groupBy(acceptanceChallenges.failureReason)
    .orderBy(desc(sql`count(*)`))
    .limit(6);

  // ---- version coverage: who is on the current version of each document ----------------------------
  const coverage = await versionCoverage(deps, organizationId, q.documentId);

  // ---- proofs and the Gate ----------------------------------------------------------------------------
  const proofRows = q.documentId
    ? []
    : await db
        .select({ type: proofs.proofType, n: sql<number>`count(*)::int` })
        .from(proofs)
        .where(
          and(
            eq(proofs.organizationId, organizationId),
            gte(proofs.createdAt, from),
            lt(proofs.createdAt, to),
          ),
        )
        .groupBy(proofs.proofType)
        .orderBy(desc(sql`count(*)`));

  const gateRows = await db
    .select({
      documentId: accessPasses.documentId,
      current: sql<number>`count(*) filter (where ${accessPasses.versionNumber} >= ${gatePolicies.requiredVersion})::int`,
      outdated: sql<number>`count(*) filter (where ${accessPasses.versionNumber} < ${gatePolicies.requiredVersion})::int`,
    })
    .from(accessPasses)
    .innerJoin(gatePolicies, eq(gatePolicies.documentId, accessPasses.documentId))
    .where(
      and(
        eq(accessPasses.organizationId, organizationId),
        ...(q.documentId ? [eq(accessPasses.documentId, q.documentId)] : []),
      ),
    )
    .groupBy(accessPasses.documentId);

  const top = <T extends { n: number }>(rows: T[], key: (r: T) => string | null, max = 6) => {
    const named = rows.filter((r) => key(r)).map((r) => ({ label: key(r)!, count: r.n }));
    const head = named.slice(0, max);
    const rest = named.slice(max).reduce((x, r) => x + r.count, 0);
    return rest > 0 ? [...head, { label: "Other", count: rest }] : head;
  };

  return {
    range: { from: from.toISOString(), to: to.toISOString(), days: q.days },
    totals: {
      acceptances: current.acceptances,
      previousAcceptances: previous.acceptances,
      people: current.people,
      previousPeople: previous.people,
      completionRate: current.completionRate,
      previousCompletionRate: previous.completionRate,
      medianSecondsToSign:
        timing?.median === null || timing?.median === undefined ? null : Number(timing.median),
      feeLamports: current.feeLamports,
      feePerAcceptance:
        current.acceptances > 0 ? Math.round(current.feeLamports / current.acceptances) : null,
    },
    funnel: current.funnel,
    daily,
    methods: {
      wallet: daily.reduce((x, d) => x + d.wallet, 0),
      passkey: daily.reduce((x, d) => x + d.passkey, 0),
    },
    hours,
    timeZones: top(zoneRows, (r) => r.zone),
    domains: top(domainRows, (r) => r.domain),
    failures: failureRows.map((r) => ({ reason: r.reason ?? "unknown", count: r.n })),
    coverage,
    proofs: proofRows.map((r) => ({ type: r.type, count: r.n })),
    gate: {
      current: gateRows.reduce((x, r) => x + r.current, 0),
      outdated: gateRows.reduce((x, r) => x + r.outdated, 0),
    },
  };
}

/** Per document: how many people's latest acceptance is each version, against the current one. */
export async function versionCoverage(deps: Deps, organizationId: string, documentId?: string) {
  const docs = await deps.db
    .select({
      id: documents.id,
      slug: documents.slug,
      versionCount: documents.versionCount,
      current: documents.currentVersionAddress,
    })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        ...(documentId ? [eq(documents.id, documentId)] : []),
      ),
    );
  if (docs.length === 0) return [];
  const latest = deps.db
    .select({
      documentId: acceptances.documentId,
      who: person.as("who"),
      version: sql<number>`max(${acceptances.versionNumber})`.as("version"),
    })
    .from(acceptances)
    .where(
      and(
        eq(acceptances.organizationId, organizationId),
        inArray(
          acceptances.documentId,
          docs.map((d) => d.id),
        ),
      ),
    )
    .groupBy(acceptances.documentId, person)
    .as("latest");
  const rows = await deps.db
    .select({
      documentId: latest.documentId,
      version: latest.version,
      n: sql<number>`count(*)::int`,
    })
    .from(latest)
    .groupBy(latest.documentId, latest.version);
  const titles = await deps.db
    .select({ address: documentVersions.address, title: documentVersions.title })
    .from(documentVersions)
    .where(
      inArray(
        documentVersions.address,
        docs.map((d) => d.current).filter((a): a is string => !!a),
      ),
    );
  return docs
    .map((d) => {
      const versions = rows
        .filter((r) => r.documentId === d.id)
        .map((r) => ({ number: Number(r.version), people: r.n }))
        .sort((a, b) => b.number - a.number);
      const total = versions.reduce((x, v) => x + v.people, 0);
      const onCurrent = versions
        .filter((v) => v.number >= d.versionCount)
        .reduce((x, v) => x + v.people, 0);
      return {
        documentId: d.id,
        slug: d.slug,
        title: titles.find((t) => t.address === d.current)?.title ?? d.slug,
        currentVersion: d.versionCount,
        people: total,
        onCurrent,
        needsReacceptance: total - onCurrent,
        versions,
      };
    })
    .filter((d) => d.people > 0)
    .sort((a, b) => b.people - a.people);
}

/** The people whose latest acceptance of `documentId` is older than its current version. */
export async function reacceptanceList(deps: Deps, organizationId: string, documentId: string) {
  const [doc] = await deps.db
    .select({ slug: documents.slug, versionCount: documents.versionCount })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)));
  if (!doc) return null;
  const rows = await deps.db
    .select({
      who: person,
      userRef: sql<string | null>`max(${acceptances.externalUserRef})`,
      signer: sql<string>`max(${acceptances.signerAddress})`,
      version: sql<number>`max(${acceptances.versionNumber})::int`,
      lastAcceptedAt: sql<string>`max(${acceptances.createdAt})`,
    })
    .from(acceptances)
    .where(
      and(eq(acceptances.organizationId, organizationId), eq(acceptances.documentId, documentId)),
    )
    .groupBy(person)
    .having(sql`max(${acceptances.versionNumber}) < ${doc.versionCount}`)
    .orderBy(desc(sql`max(${acceptances.createdAt})`))
    .limit(5000);
  return {
    document: doc.slug,
    currentVersion: doc.versionCount,
    people: rows.map((r) => ({
      userRef: r.userRef,
      signer: r.signer,
      acceptedVersion: r.version,
      lastAcceptedAt: new Date(r.lastAcceptedAt).toISOString(),
    })),
  };
}
