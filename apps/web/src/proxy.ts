/**
 * Per-request Content Security Policy with a fresh nonce, plus baseline security headers.
 *
 * Scripts run only when they carry this request's nonce ('strict-dynamic' extends trust to the
 * scripts Next.js loads). Pages are rendered dynamically so the nonce is applied to every script.
 * Network access is limited to this origin and the configured Solana RPC endpoints; the verifier
 * pages may additionally reach any HTTPS endpoint, because letting users pick their own RPC
 * provider and content gateways is the point of independent verification.
 */
import { NextResponse, type NextRequest } from "next/server";

const isDev = process.env.NODE_ENV !== "production";

function origins(list: string | undefined): string[] {
  const out = new Set<string>();
  for (const raw of (list ?? "").split(",")) {
    const value = raw.trim();
    if (!value) continue;
    try {
      const u = new URL(value);
      if (u.protocol === "https:" || u.protocol === "http:") out.add(u.origin);
    } catch {
      // ignore malformed entries
    }
  }
  return [...out];
}

const RPC_ORIGINS = origins(
  process.env.PUBLIC_RPC_URLS ?? (isDev ? "http://127.0.0.1:8899,http://localhost:8899" : ""),
);
const OPEN_CONNECT_PATHS = ["/verify", "/receipt"];

function isLocalHttp(request: NextRequest): boolean {
  const host = request.nextUrl.hostname;
  return request.nextUrl.protocol === "http:" && (host === "localhost" || host === "127.0.0.1");
}

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const openConnect = OPEN_CONNECT_PATHS.some(
    (p) => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(`${p}/`),
  );

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // React style attributes require 'unsafe-inline' for styles; script execution stays nonce-gated.
    "style-src 'self' 'unsafe-inline'",
    // Wallet Standard icons are data: URIs; QR codes are rendered to data: URIs locally.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${RPC_ORIGINS.join(" ")}${openConnect ? " https:" : ""}${isDev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "manifest-src 'self'",
    // Production is served over HTTPS; plain-HTTP localhost (a local production build) is exempt.
    ...(isDev || isLocalHttp(request) ? [] : ["upgrade-insecure-requests"]),
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  // Some wallets open popups and talk to the opener; `same-origin-allow-popups` keeps that working.
  response.headers.set("cross-origin-opener-policy", "same-origin-allow-popups");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  if (!isDev)
    response.headers.set(
      "strict-transport-security",
      "max-age=63072000; includeSubDomains; preload",
    );
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api/|sdk/|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
