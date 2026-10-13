/**
 * PDF receipts ("Certificate of Acceptance"), in any language.
 *
 * The certificate is an HTML template rendered by Chromium in the internal pdf-renderer service:
 * Chromium shapes every script (HarfBuzz), lays out right-to-left text (bidi) and the image ships
 * Noto fonts for all of them, so the text stays real, selectable text. The original JSON receipt is
 * then attached to the PDF, uncompressed and marked, so the Verify page (and anyone) can extract
 * it and verify it against Solana. The PDF's visible text is a readable copy, never evidence.
 */
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import QRCode from "qrcode";
import type { Receipt, ReceiptV2 } from "@stelehq/protocol";
import type { Deps } from "../deps.js";
import { ApiError } from "../errors.js";

/** The off-chain audit trail shown on the certificate (not evidence, not in the receipt). */
export interface ReceiptAudit {
  ip?: string | null;
  timeZone?: string | null;
  utcOffsetMinutes?: number | null;
}

type AnyReceipt = Receipt | ReceiptV2;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "12 October 2026, 12:23:15" for a UTC instant shifted by `offsetMinutes`. */
function longTime(seconds: number, offsetMinutes = 0): string {
  const d = new Date((seconds + offsetMinutes * 60) * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

function offsetLabel(minutes: number): string {
  const m = Math.abs(minutes);
  return `UTC${minutes < 0 ? "-" : "+"}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function signerOf(r: AnyReceipt): { kind: string; key: string } {
  if ("signer" in r && r.signer && "publicKey" in r.signer) {
    if (r.signer.type === "NATIVE_PASSKEY")
      return { kind: "Passkey (P-256), verified on-chain", key: r.signer.publicKey };
    return { kind: "Ed25519 key", key: r.signer.publicKey };
  }
  const v1 = r as Receipt;
  const type = (v1 as { signer?: { type?: string } }).signer?.type;
  return {
    kind:
      type === "PASSKEY_PROTECTED_STELE_KEY"
        ? "Passkey-protected key (Ed25519)"
        : "Wallet (Ed25519)",
    key: v1.acceptance.signer,
  };
}

const row = (label: string, value: string, cls = "") =>
  `<tr><th>${esc(label)}</th><td class="${cls}" dir="auto">${value}</td></tr>`;

function documentHtml(blocks: Record<string, unknown>[]): string {
  return blocks
    .map((b) => {
      if (b.type === "heading") {
        const tag = Number(b.level) === 1 ? "h3" : "h4";
        return `<${tag} dir="auto">${esc(b.text)}</${tag}>`;
      }
      if (b.type === "paragraph") return `<p dir="auto">${esc(b.text)}</p>`;
      if (b.type === "list" && Array.isArray(b.items)) {
        const tag = b.ordered ? "ol" : "ul";
        return `<${tag}>${(b.items as unknown[]).map((i) => `<li dir="auto">${esc(i)}</li>`).join("")}</${tag}>`;
      }
      return "";
    })
    .join("\n");
}

const CSS = `
@page { size: A4; margin: 16mm 0 18mm 0; }
@page :first { margin-top: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  font-family: "Noto Sans", "Noto Sans Georgian", "Noto Sans Armenian", "Noto Sans Hebrew",
    "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans Thai", "Noto Sans CJK SC",
    "Noto Color Emoji", sans-serif;
  color: #33404d; font-size: 9.5pt; line-height: 1.45;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.wrap { padding: 0 18mm; }
header.band { background: #0b1117; color: #fff; padding: 15mm 18mm 9mm; border-bottom: 3px solid #0e6e8c;
  display: flex; justify-content: space-between; align-items: center; }
.brand { font-weight: 700; letter-spacing: 3px; font-size: 10pt; display: flex; align-items: center; gap: 8px; }
.brand i { display: inline-block; width: 9px; height: 15px; background: #4cc9f0; border-radius: 1px; }
h1 { font-family: "Noto Serif", "Noto Sans Georgian", serif; font-weight: 700; font-size: 25pt;
  margin: 10px 0 6px; letter-spacing: -0.2px; }
.sub { color: #b8c7d6; font-size: 9.5pt; line-height: 1.5; }
.seal { width: 30mm; height: 30mm; border: 1.6px solid #4cc9f0; border-radius: 50%; flex: none;
  display: flex; align-items: center; justify-content: center; position: relative; }
.seal::before { content: ""; position: absolute; inset: 2.2mm; border: 0.7px solid #4cc9f0; border-radius: 50%; }
.seal div { text-align: center; font-weight: 700; font-size: 6.5pt; letter-spacing: 1px; line-height: 1.35; }
.seal svg { display: block; margin: 0 auto 2px; }
.statement { margin: 7mm 0 2mm; background: #e8f4f8; border-left: 3px solid #0e6e8c; padding: 4mm 5mm; }
.statement p { margin: 0; font-family: "Noto Serif", "Noto Sans Georgian", serif; font-style: italic;
  font-size: 12pt; color: #111820; line-height: 1.45; }
.statement small { display: block; margin-top: 2mm; color: #727f8c; font-size: 8pt; }
section { margin-top: 6mm; }
h2 { font-size: 8.6pt; letter-spacing: 1.2px; text-transform: uppercase; color: #111820; margin: 0 0 1.5mm;
  padding-bottom: 1.5mm; border-bottom: 0.6px solid #dde2e7; position: relative; break-after: avoid; }
h2::after { content: ""; position: absolute; left: 0; bottom: -0.6px; width: 9mm; border-bottom: 1.4px solid #0e6e8c; }
h2 b { color: #0e6e8c; margin-right: 3mm; }
table { width: 100%; border-collapse: collapse; }
th { width: 44mm; text-align: left; font-weight: 400; color: #727f8c; font-size: 8.5pt; padding: 1.3mm 0; vertical-align: top; }
td { color: #111820; padding: 1.3mm 0; vertical-align: top; }
td .note, .note { color: #727f8c; font-size: 8pt; }
.mono { font-family: "Noto Sans Mono", monospace; font-size: 8.2pt; word-break: break-all; }
a { color: #0e6e8c; text-decoration: none; }
.doc { border-left: 2.5px solid #0e6e8c; padding: 1mm 0 1mm 5mm; margin: 2.5mm 0 2mm; }
.doc h3 { font-family: "Noto Serif", "Noto Sans Georgian", serif; font-size: 14pt; margin: 1mm 0 2mm; color: #111820; }
.doc h4 { font-family: "Noto Serif", "Noto Sans Georgian", serif; font-size: 11pt; margin: 3mm 0 1mm; color: #111820; }
.doc p { margin: 0 0 1.6mm; }
.doc ul, .doc ol { margin: 0 0 1.6mm; padding-inline-start: 6mm; }
.message { background: #f6f7f9; border: 0.5px solid #dde2e7; padding: 3.5mm 4mm; margin-top: 2mm;
  font-family: "Noto Sans Mono", monospace; font-size: 7.8pt; line-height: 1.5; color: #33404d; }
.message div { unicode-bidi: plaintext; white-space: pre-wrap; word-break: break-all; }
.check { border: 0.6px solid #dde2e7; padding: 4mm 5mm; display: flex; justify-content: space-between;
  gap: 6mm; align-items: center; margin-top: 2.5mm; break-inside: avoid; }
.check ol { margin: 0; padding: 0; list-style: none; counter-reset: s; }
.check li { counter-increment: s; position: relative; padding-left: 9mm; margin: 0 0 3mm; color: #111820; }
.check li::before { content: counter(s); position: absolute; left: 0; top: -0.3mm; width: 5mm; height: 5mm;
  border: 0.8px solid #0e6e8c; border-radius: 50%; color: #0e6e8c; font-weight: 700; font-size: 7.5pt;
  display: flex; align-items: center; justify-content: center; }
.qr { text-align: center; flex: none; }
.qr svg { width: 30mm; height: 30mm; display: block; }
.qr span { font-size: 7pt; color: #727f8c; }
.proves { break-inside: avoid; }
.proves div { margin: 1.2mm 0; }
.proves b { display: inline-block; width: 5mm; font-weight: 700; }
.plus { color: #1d8a5e; } .minus { color: #727f8c; }
.avoid { break-inside: avoid; }
`;

/** The certificate as HTML, and the footer template for every page. */
export async function receiptHtml(
  r: AnyReceipt,
  opts: { verifyBase: string; audit?: ReceiptAudit | null },
): Promise<{ html: string; footer: string }> {
  const audit = opts.audit ?? null;
  const s = signerOf(r);
  const company = r.organization.name;
  const block = r.transaction.blockTime;
  const accepted = block ? `${longTime(block)} UTC` : "—";
  const local =
    block && typeof audit?.utcOffsetMinutes === "number"
      ? `${longTime(block, audit.utcOffsetMinutes)} signer's local time (${
          audit.timeZone ? `${esc(audit.timeZone)}, ` : ""
        }${offsetLabel(audit.utcOffsetMinutes)})`
      : null;
  const cluster = r.network.label.toLowerCase().includes("devnet") ? "?cluster=devnet" : "";
  const explorer = `https://explorer.solana.com/tx/${r.transaction.signature}${cluster}`;
  const verifyTx = `${opts.verifyBase}?tx=${r.transaction.signature}`;
  const qr = await QRCode.toString(verifyTx, { type: "svg", errorCorrectionLevel: "M", margin: 0 });
  const blocks = (r as { content?: { blocks: Record<string, unknown>[] } }).content?.blocks ?? [];
  const sig = (r.acceptance as { signature?: string | null }).signature ?? null;
  const fees = (r as { fees?: { feeLamports: number; sponsor: string } }).fees;
  const effectiveAt = r.version.effectiveAt;
  const verifyHost = opts.verifyBase.replace(/^https?:\/\//, "");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Certificate of Acceptance</title><style>${CSS}</style></head><body>
<header class="band">
  <div>
    <div class="brand"><i></i>STELE</div>
    <h1>Certificate of Acceptance</h1>
    <div class="sub">Evidence recorded on ${esc(r.network.label)}<br>Verifiable by anyone, without Stele and without the company</div>
  </div>
  <div class="seal"><div><svg width="22" height="16" viewBox="0 0 22 16"><path d="M2 8l6 6L20 2" stroke="#4cc9f0" stroke-width="2.6" fill="none"/></svg>RECORDED<br>ON SOLANA</div></div>
</header>
<div class="wrap">
  <div class="statement">
    <p dir="auto">On ${esc(accepted)}, the holder of the key below accepted “${esc(r.version.title)}” (version ${esc(r.version.label)}) published by ${esc(company)}.</p>
    <small>The record is on Solana: it cannot be changed or backdated, and stays checkable even if this website disappears.</small>
  </div>

  <section><h2><b>01</b>The document</h2><table>
    ${row("Company", esc(company))}
    ${row(
      "Company website",
      r.organization.verifiedDomain
        ? `${esc(r.organization.verifiedDomain)} · ownership verified and recorded on Solana`
        : "Not verified · the company has not proven a website",
    )}
    ${row("Document", esc(r.version.title))}
    ${row("Version", `${esc(r.version.label)} (version #${r.version.number})`)}
    ${row(
      "This version published",
      `${longTime(r.version.publishedAt)} UTC<div class="note">Every change is a new version: this is when the terms last changed.</div>`,
    )}
    ${effectiveAt ? row("Effective from", `${longTime(effectiveAt)} UTC`) : ""}
    ${row("Digital fingerprint", esc(r.version.versionHash), "mono")}
  </table></section>

  <section><h2><b>02</b>Full text of the document</h2>
    ${blocks.length ? `<div class="doc">${documentHtml(blocks)}</div>` : `<p>The document text is not included in this receipt.</p>`}
    <div class="note">This is the exact text that was accepted. Changing even one character would change the digital fingerprint above, which is recorded on Solana.</div>
  </section>

  <section class="avoid"><h2><b>03</b>The signature</h2><table>
    ${row("Signed using", esc(s.kind))}
    ${row("Signer's key", esc(s.key), "mono")}
    ${row("Accepted at", `${esc(accepted)}${local ? `<br>${local}` : ""}`)}
    ${row(
      "Signing window",
      `${longTime(r.acceptance.issuedAt)} – ${longTime(r.acceptance.expiresAt).split(", ")[1]} UTC<div class="note">The signature could be recorded only within this window.</div>`,
    )}
    ${row("Requested from", esc(r.acceptance.requestDomain))}
    ${
      fees
        ? row(
            "Cost to the signer",
            `Nothing · the network fee (${(fees.feeLamports / 1e9).toFixed(6)} SOL) was paid by ${
              fees.sponsor === "STELE" ? "Stele" : esc(company)
            }`,
          )
        : ""
    }
  </table></section>

  ${
    audit && (audit.ip || audit.timeZone)
      ? `<section class="avoid"><h2><b>04</b>Audit trail</h2>
    <div class="note">Recorded by Stele's server when the signature was submitted. This part is not on Solana and is not checked by the verifier.</div>
    <table>
      ${audit.ip ? row("IP address", esc(audit.ip), "mono") : ""}
      ${
        audit.timeZone || typeof audit.utcOffsetMinutes === "number"
          ? row(
              "Device time zone",
              `${esc(audit.timeZone ?? "—")}${typeof audit.utcOffsetMinutes === "number" ? ` (${offsetLabel(audit.utcOffsetMinutes)})` : ""}`,
            )
          : ""
      }
    </table></section>`
      : ""
  }

  <section class="avoid"><h2><b>${audit && (audit.ip || audit.timeZone) ? "05" : "04"}</b>Proof on Solana</h2><table>
    ${row("Network", `${esc(r.network.label)} (${esc(r.network.chainId)})`)}
    ${row("Transaction", esc(r.transaction.signature), "mono")}
    ${row("View it online", `<a href="${esc(explorer)}">Open the transaction in Solana Explorer</a>`)}
    ${sig ? row("Signature", esc(sig), "mono") : ""}
    ${row("Receipt ID", esc(r.acceptanceId), "mono")}
  </table></section>

  <section class="avoid"><h2><b>${audit && (audit.ip || audit.timeZone) ? "06" : "05"}</b>The message that was signed</h2>
    <div class="note">This short message is what the key actually signed. It names the document by its fingerprint, so it cannot be reused for any other text. “Issued” and “Expires” are the signing window above; the moment of acceptance is when Solana recorded it.</div>
    <div class="message">${r.acceptance.message
      .split("\n")
      .map((l) => `<div>${esc(l) || "&nbsp;"}</div>`)
      .join("")}</div>
  </section>

  <section class="avoid"><h2><b>${audit && (audit.ip || audit.timeZone) ? "07" : "06"}</b>How anyone can check this</h2>
    <div class="check">
      <ol>
        <li>Scan the code. It opens the check for this exact transaction:<br><a class="mono" href="${esc(verifyTx)}">${esc(verifyHost)}</a></li>
        <li>Or upload this PDF on the Verify page. The original receipt (stele-receipt.json) is attached inside this PDF.</li>
        <li>Or check it with no website at all, using the free open-source tool: <span class="mono">npx @stelehq/verifier</span></li>
      </ol>
      <a class="qr" href="${esc(verifyTx)}">${qr}<span>Scan to verify</span></a>
    </div>
  </section>

  <section class="proves"><h2><b>${audit && (audit.ip || audit.timeZone) ? "08" : "07"}</b>What this certificate proves</h2>
    <div><b class="plus">+</b>This key accepted exactly this text, in this version, at the time shown.</div>
    <div><b class="plus">+</b>Nobody — not the company, not Stele — can change the text or the time afterwards.</div>
    <div><b class="plus">+</b>It keeps working even if the company's website or Stele disappears.</div>
    <div><b class="minus">–</b>It does not prove who holds the key: a signature is not an identity check.</div>
    <p class="note">This document is a readable copy. The evidence is the Solana transaction and the attached original receipt, which the verifier re-checks.</p>
  </section>
</div>
</body></html>`;

  const footer = `<div style="box-sizing:border-box;width:100%;padding:0 18mm;font-family:'Noto Sans',sans-serif;font-size:7pt;color:#727f8c;">
<div style="display:flex;justify-content:space-between;border-top:0.5px solid #dde2e7;padding-top:2mm;">
<span>Stele · Certificate of Acceptance · Receipt ${esc(r.acceptanceId.slice(0, 20))}… · verify: ${esc(verifyHost)}</span>
<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div></div>`;
  return { html, footer };
}

/** Renders HTML to PDF with the internal renderer. */
async function render(deps: Deps, html: string, footer: string): Promise<Uint8Array> {
  const base = deps.config.PDF_RENDERER_URL;
  if (!base)
    throw new ApiError(503, "pdf_unavailable", "PDF receipts are not enabled on this server");
  const res = await fetch(`${base}/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html, footer }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!res?.ok)
    throw new ApiError(503, "pdf_unavailable", "The PDF could not be produced, try again");
  return new Uint8Array(await res.arrayBuffer());
}

/** Attaches the original receipt (uncompressed, marked) and sets the document metadata. */
async function attachReceipt(
  pdfBytes: Uint8Array,
  receipt: AnyReceipt,
  verifyBase: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  // ASCII JSON (non-ASCII escaped) so it can be found and read back byte for byte.
  const json = JSON.stringify(receipt, null, 2).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const ctx = pdf.context;
  const file = ctx.register(
    ctx.stream(new TextEncoder().encode(json), {
      Type: "EmbeddedFile",
      Subtype: "application/json",
      SteleReceipt: true,
    }),
  );
  const spec = ctx.register(
    ctx.obj({
      Type: "Filespec",
      F: PDFString.of("stele-receipt.json"),
      UF: PDFHexString.fromText("stele-receipt.json"),
      EF: { F: file },
      Desc: PDFHexString.fromText(`Original Stele receipt — verify at ${verifyBase}`),
    }),
  );
  pdf.catalog.set(
    PDFName.of("Names"),
    ctx.obj({ EmbeddedFiles: { Names: [PDFString.of("stele-receipt.json"), spec] } }),
  );
  pdf.setTitle(`Certificate of Acceptance — ${receipt.version.title}`);
  pdf.setAuthor("Stele");
  pdf.setCreator("Stele");
  pdf.setProducer("Stele");
  return pdf.save({ useObjectStreams: false });
}

/** The full certificate PDF for a verified receipt. */
export async function receiptPdf(
  deps: Deps,
  receipt: AnyReceipt,
  audit?: ReceiptAudit | null,
): Promise<Uint8Array> {
  const verifyBase = `${deps.config.APP_ORIGIN}/verify`;
  const { html, footer } = await receiptHtml(receipt, { verifyBase, audit });
  return attachReceipt(await render(deps, html, footer), receipt, verifyBase);
}
