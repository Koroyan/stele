/** Internal helpers (not exported from the package index). */

/**
 * A copy of `bytes` backed by a plain `ArrayBuffer`: what WebCrypto accepts under every TypeScript
 * lib configuration (browser DOM types and Node-only types alike).
 */
export function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}
