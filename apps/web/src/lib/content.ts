/** Fetches canonical content by hash and verifies it in the browser before use. */
import {
  bytesEqual,
  contentHash,
  fromHex,
  parseCanonicalContent,
  type Content,
} from "@stele/protocol";

const cache = new Map<string, Promise<Content>>();

export function loadVerifiedContent(hashHex: string): Promise<Content> {
  let p = cache.get(hashHex);
  if (!p) {
    p = (async () => {
      const res = await fetch(`/api/v1/public/content/${hashHex}`, { cache: "force-cache" });
      if (!res.ok)
        throw new Error(`Content ${hashHex.slice(0, 12)}… is unavailable (HTTP ${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytesEqual(contentHash(bytes), fromHex(hashHex, 32))) {
        throw new Error(
          "The content served does not match its SHA-256 commitment. It was not displayed.",
        );
      }
      return parseCanonicalContent(bytes);
    })();
    cache.set(hashHex, p);
    p.catch(() => cache.delete(hashHex));
  }
  return p;
}
