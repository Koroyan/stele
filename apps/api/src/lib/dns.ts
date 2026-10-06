/**
 * Domain-control checks via DNS-over-HTTPS. The API only ever talks to fixed resolvers (never to a
 * customer-supplied host), and a record must be visible through EVERY configured resolver.
 */
export const TXT_PREFIX = "_stele";

export function txtRecordName(domain: string): string {
  return `${TXT_PREFIX}.${domain}`;
}

export function txtRecordValue(organizationAddress: string): string {
  return `stele-org=${organizationAddress}`;
}

export async function resolveTxt(
  resolverUrl: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const url = `${resolverUrl}?name=${encodeURIComponent(name)}&type=TXT`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetchImpl(url, {
      headers: { accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!res.ok)
      throw new Error(`resolver ${new URL(resolverUrl).host} returned HTTP ${res.status}`);
    const body = (await res.json()) as {
      Status?: number;
      Answer?: { type: number; data: string }[];
    };
    return (body.Answer ?? [])
      .filter((a) => a.type === 16)
      .map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
  } finally {
    clearTimeout(timer);
  }
}

export interface DomainCheckResult {
  verified: boolean;
  perResolver: { resolver: string; found: boolean; error?: string }[];
}

export async function checkDomainControl(
  domain: string,
  organizationAddress: string,
  resolvers: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<DomainCheckResult> {
  const expected = txtRecordValue(organizationAddress);
  const perResolver = await Promise.all(
    resolvers.map(async (resolver) => {
      try {
        const records = await resolveTxt(resolver, txtRecordName(domain), fetchImpl);
        return { resolver: new URL(resolver).host, found: records.includes(expected) };
      } catch (e) {
        return {
          resolver: new URL(resolver).host,
          found: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
  return { verified: perResolver.length > 0 && perResolver.every((r) => r.found), perResolver };
}
