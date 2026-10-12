/** This Stele app's public address, filled into code samples so readers can paste them as they are. */
import { headers } from "next/headers";

/**
 * `APP_ORIGIN` when configured (always in deployments): samples must never take their API address
 * from request headers there, or a cache keyed without the Host header could serve developers
 * samples that send API keys elsewhere. Without it (local development), the address the browser used.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.APP_ORIGIN;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // malformed: fall through to the development fallback
    }
  }
  const h = await headers();
  const host = h.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host)) return "https://stele.site";
  return `http://${host}`;
}
