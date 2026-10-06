/**
 * SSRF defences for server-initiated HTTP requests (webhook deliveries).
 *
 * * Only `https:` URLs (plain `http:` to loopback only outside production).
 * * No credentials in URLs, no non-default ports below 1024 except 443.
 * * Every resolved address is checked at CONNECTION time via a custom `lookup`, which defeats DNS
 *   rebinding (the address that is validated is the address that is dialled).
 * * Private, loopback, link-local, CGNAT, multicast, reserved and cloud-metadata ranges are blocked.
 * * No redirects are followed; responses are size- and time-limited.
 */
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP, type LookupFunction } from "node:net";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    // Same network iff the top `bits` bits are equal.
    const inBlock = ([base, bits]: [string, number]) => (n ^ ipv4ToInt(base)) >>> (32 - bits) === 0;
    return !V4_BLOCKS.some(inBlock);
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicIp(mapped[1]!);
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
    if (lower.startsWith("2001:db8")) return false; // documentation
    if (lower.startsWith("64:ff9b")) return false; // NAT64 (may reach private v4)
    return true;
  }
  return false;
}

export interface UrlPolicy {
  allowInsecureLoopback: boolean;
}

/** Static validation of a webhook URL (before any network access). */
export function validateOutboundUrl(raw: string, policy: UrlPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed");
  const loopbackHost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "http:") {
    if (!(policy.allowInsecureLoopback && loopbackHost))
      throw new Error("webhook URLs must use https");
  } else if (url.protocol !== "https:") {
    throw new Error("webhook URLs must use https");
  }
  if (url.port && url.port !== "443" && Number(url.port) < 1024 && !loopbackHost)
    throw new Error("privileged ports are not allowed");
  if (url.hash) throw new Error("URL fragments are not allowed");
  if (!loopbackHost || !policy.allowInsecureLoopback) {
    if (
      isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
      !isPublicIp(url.hostname.replace(/^\[|\]$/g, ""))
    ) {
      throw new Error("URL points to a private or reserved address");
    }
    if (/(^|\.)(localhost|local|internal|localdomain)$/i.test(url.hostname))
      throw new Error("internal hostnames are not allowed");
  }
  return url;
}

/** DNS lookup that refuses non-public addresses (checked at connect time). */
export function safeLookup(policy: UrlPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = Array.isArray(addresses) ? addresses : [];
      const loopbackOk =
        policy.allowInsecureLoopback && (hostname === "localhost" || hostname === "127.0.0.1");
      const allowed = list.filter((a) => loopbackOk || isPublicIp(a.address));
      if (allowed.length === 0)
        return callback(
          new Error(`refusing to connect to non-public address for ${hostname}`),
          "",
          4,
        );
      const first = allowed[0]!;
      if ((options as { all?: boolean }).all)
        return (callback as unknown as (e: null, a: typeof allowed) => void)(null, allowed);
      return callback(null, first.address, first.family);
    });
  };
}

export interface OutboundResponse {
  status: number;
  body: string;
}

/** POSTs JSON with SSRF protections, no redirects, a timeout and a response size cap. */
export function safePost(
  url: URL,
  body: string,
  headers: Record<string, string>,
  policy: UrlPolicy,
  timeoutMs = 10_000,
): Promise<OutboundResponse> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolvePromise, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body).toString(),
          ...headers,
        },
        lookup: safeLookup(policy),
        timeout: timeoutMs,
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= 16_384) chunks.push(c);
        });
        res.on("end", () =>
          resolvePromise({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
