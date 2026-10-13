/**
 * PDF receipts: a printable receipt with the full JSON receipt embedded as a file attachment.
 *
 * The PDF is only a carrier. Verification never trusts what the PDF says: the Verify page extracts
 * the embedded JSON receipt and re-checks every claim against Solana, exactly as for a .json file.
 * The PDF is written by hand (no PDF dependency): ASCII only, standard fonts, uncompressed streams,
 * so the embedded receipt can be found again with a simple scan.
 */
import QRCode from "qrcode";

const MARKER = "/SteleReceipt true";

/** The fields a PDF needs; stele-receipt-v1 and -v2 acceptance receipts both provide them. */
export interface PdfReceipt {
  acceptanceId: string;
  network: { chainId: string; label: string; programId: string };
  transaction: { signature: string; blockTime: number | null };
  acceptance: {
    message: string;
    requestDomain: string;
    signer?: string;
    signature?: string | null;
  };
  signer?: { type: string; publicKey?: string };
  content?: { blocks: Record<string, unknown>[] };
  organization: { name: string; verifiedDomain: string | null };
  version: {
    title: string;
    label: string;
    number: number;
    versionHash: string;
    publishedAt?: number;
  };
  fees?: { payer: string; sponsor: string; feeLamports: number };
}

// ---- PDF primitives -------------------------------------------------------------------------------

const W = 595;
const H = 842;
const M = 48; // page margin
const INK = "0.043 0.067 0.09"; // #0B1117
const MUTED = "0.39 0.44 0.49";
const ACCENT = "0.055 0.431 0.549"; // #0E6E8C
const LINE = "0.86 0.88 0.9";
const PANEL = "0.955 0.963 0.97";
const OK = "0.114 0.541 0.369"; // #1D8A5E

/** JSON with every non-ASCII character escaped, so the PDF stays pure ASCII (byte = char). */
function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** A PDF string literal body: printable ASCII only, with (, ) and \ escaped. */
function str(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function chunk(s: string, n: number): string[] {
  if (s.length <= n) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

/** Word-wraps proportional text to roughly `n` characters per line. */
function words(s: string, n: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(" ")) {
    if (line && `${line} ${w}`.length > n) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.flatMap((l) => chunk(l, n));
}

function iso(seconds: number | null | undefined): string {
  return seconds
    ? new Date(seconds * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC")
    : "-";
}

type Font = "F1" | "F2" | "F3"; // Helvetica, Helvetica-Bold, Courier

/** A simple top-down page writer. */
class Pages {
  readonly pages: string[][] = [[]];
  /** Clickable areas per page: [x, y, w, h, uri]. */
  readonly links: [number, number, number, number, string][][] = [[]];
  y = H - M;

  private get ops() {
    return this.pages[this.pages.length - 1]!;
  }

  /** Starts a new page when fewer than `need` points remain. */
  ensure(need: number) {
    if (this.y - need < M + 30) {
      this.pages.push([]);
      this.links.push([]);
      this.y = H - M;
    }
  }

  rect(x: number, y: number, w: number, h: number, rgb: string) {
    this.ops.push(`${rgb} rg ${x} ${y} ${w} ${h} re f`);
  }

  link(x: number, y: number, w: number, h: number, uri: string) {
    this.links[this.links.length - 1]!.push([x, y, w, h, uri]);
  }

  hline(y: number) {
    this.ops.push(`${LINE} RG 0.6 w ${M} ${y} m ${W - M} ${y} l S`);
  }

  text(x: number, y: number, s: string, font: Font, size: number, rgb = INK) {
    this.ops.push(`BT ${rgb} rg /${font} ${size} Tf ${x} ${y} Td (${str(s)}) Tj ET`);
  }

  heading(title: string) {
    this.ensure(40);
    this.y -= 22;
    this.text(M, this.y, title.toUpperCase(), "F2", 8.5, ACCENT);
    this.y -= 7;
    this.hline(this.y);
    this.y -= 4;
  }

  /** A label/value row; `mono` values use Courier and wrap at a fixed width. */
  row(label: string, value: string, mono = false, uri?: string) {
    const lines = mono ? chunk(value, 72) : words(value, 70);
    this.ensure(14 + lines.length * 12);
    this.y -= 14;
    this.text(M, this.y, label, "F1", 8.5, MUTED);
    lines.forEach((l, i) => {
      if (i > 0) this.y -= 12;
      this.text(M + 128, this.y, l, mono ? "F3" : "F1", mono ? 8.5 : 9.5, uri ? ACCENT : INK);
      if (uri) this.link(M + 126, this.y - 3, W - 2 * M - 126, 12, uri);
    });
  }

  /** A paragraph of body text. */
  para(s: string, font: Font, size: number, indent = 0, gapBefore = 0) {
    const lines = words(s, Math.floor((W - 2 * M - indent) / (size * 0.5)));
    this.y -= gapBefore;
    for (const l of lines) {
      this.ensure(size + 4);
      this.y -= size + 3.5;
      this.text(M + indent, this.y, l, font, size);
    }
  }
}

// ---- Receipt layout -------------------------------------------------------------------------------

function signerOf(r: PdfReceipt): { kind: string; key: string } {
  if (r.signer?.type === "NATIVE_PASSKEY")
    return { kind: "Passkey (P-256), verified on-chain", key: r.signer.publicKey ?? "-" };
  if (r.signer?.type === "PASSKEY_PROTECTED_STELE_KEY")
    return { kind: "Passkey-protected key (Ed25519)", key: r.acceptance.signer ?? "-" };
  if (r.signer?.publicKey) return { kind: "Ed25519 key", key: r.signer.publicKey };
  return { kind: "Wallet (Ed25519)", key: r.acceptance.signer ?? "-" };
}

function explorerUrl(r: PdfReceipt): string {
  const label = r.network.label.toLowerCase();
  const cluster = label.includes("devnet") ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${r.transaction.signature}${cluster}`;
}

/** The document text, block by block (stele-content-v1). */
function documentText(p: Pages, blocks: Record<string, unknown>[]) {
  for (const b of blocks) {
    if (b.type === "heading") {
      const level = Number(b.level) || 1;
      p.para(String(b.text ?? ""), "F2", level === 1 ? 12 : 10, 0, 6);
    } else if (b.type === "paragraph") {
      p.para(String(b.text ?? ""), "F1", 9, 0, 3);
    } else if (b.type === "list" && Array.isArray(b.items)) {
      (b.items as unknown[]).forEach((item, i) =>
        p.para(`${b.ordered ? `${i + 1}.` : "-"} ${String(item)}`, "F1", 9, 10, i === 0 ? 3 : 0),
      );
    }
  }
}

function layout(r: PdfReceipt, verifyBase: string): { pages: string[][]; links: Pages["links"] } {
  const p = new Pages();

  // Header band.
  p.rect(0, H - 118, W, 118, INK);
  p.text(M, H - 46, "STELE", "F2", 11, "0.3 0.79 0.94");
  p.text(M, H - 76, "Acceptance receipt", "F2", 22, "1 1 1");
  p.text(
    M,
    H - 98,
    `Evidence recorded on ${r.network.label} - verifiable without Stele`,
    "F1",
    9.5,
    "0.75 0.8 0.85",
  );
  p.rect(W - M - 150, H - 84, 150, 24, OK);
  p.text(W - M - 136, H - 76, "Recorded on Solana", "F2", 10, "1 1 1");
  p.y = H - 130;

  const s = signerOf(r);
  const company = r.organization.name;
  const when = iso(r.transaction.blockTime);

  // In plain words first.
  p.y -= 6;
  p.para(
    `On ${when}, the holder of the key below accepted "${r.version.title}" (version ${r.version.label}) from ${company}. The acceptance is recorded on ${r.network.label}, so anyone can check it later - without asking ${company} or Stele.`,
    "F1",
    10.5,
  );

  p.heading("The document");
  p.row("Company", company);
  p.row(
    "Company website",
    r.organization.verifiedDomain
      ? `${r.organization.verifiedDomain} - ownership verified and recorded on Solana`
      : "Not verified - the company has not proven a website",
  );
  p.row("Document", r.version.title);
  p.row("Version", `${r.version.label} (version #${r.version.number})`);
  if (r.version.publishedAt) p.row("Published", iso(r.version.publishedAt));
  p.row("Digital fingerprint", r.version.versionHash, true);

  p.heading("Full text of the document");
  if (r.content?.blocks.length) documentText(p, r.content.blocks);
  else p.para("The document text is not included in this receipt.", "F1", 9);
  p.para(
    "This is the exact text that was accepted. Changing even one character would change the digital fingerprint above - and the fingerprint is recorded on Solana.",
    "F1",
    8,
    0,
    8,
  );

  p.heading("The signature");
  p.row("Signed using", s.kind);
  p.row("Signer's key", s.key, true);
  p.row("Date and time", when);
  p.row("Requested from", r.acceptance.requestDomain);
  if (r.fees)
    p.row(
      "Cost to the signer",
      `Nothing - the network fee (${(r.fees.feeLamports / 1e9).toFixed(6)} SOL) was paid by ${
        r.fees.sponsor === "STELE" ? "Stele" : company
      }`,
    );

  p.heading("Proof on Solana");
  p.row("Network", r.network.label);
  p.row("Transaction", r.transaction.signature, true);
  p.row("View it online", explorerUrl(r), false, explorerUrl(r));
  if (r.acceptance.signature) p.row("Signature", r.acceptance.signature, true);
  p.row("Receipt ID", r.acceptanceId, true);

  // The exact message, in a panel.
  p.heading("The message that was signed");
  p.para(
    "This short message is what the key actually signed. It names the document by its fingerprint, so it cannot be reused for any other text.",
    "F1",
    8.5,
  );
  const msg = r.acceptance.message.split("\n").flatMap((l) => chunk(l, 92));
  const msgH = msg.length * 10.5 + 16;
  p.ensure(msgH + 10);
  p.y -= 8;
  p.rect(M, p.y - msgH, W - 2 * M, msgH, PANEL);
  let my = p.y - 14;
  for (const l of msg) {
    p.text(M + 10, my, l, "F3", 7.8);
    my -= 10.5;
  }
  p.y -= msgH;

  // How to verify, with a QR code that opens the Verify page for this transaction.
  const qr = QRCode.create(`${verifyBase}?tx=${r.transaction.signature}`, {
    errorCorrectionLevel: "M",
  });
  const n = qr.modules.size;
  const cell = 2.2;
  const qrSize = n * cell;
  p.heading("How anyone can check this receipt");
  p.ensure(qrSize + 20);
  const top = p.y - 10;
  const qx = W - M - qrSize;
  const verifyTx = `${verifyBase}?tx=${r.transaction.signature}`;
  p.link(qx, top - qrSize, qrSize, qrSize, verifyTx);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++)
      if (qr.modules.get(row, col))
        p.rect(qx + col * cell, top - (row + 1) * cell, cell + 0.15, cell + 0.15, INK);
  const steps: [string, string, boolean][] = [
    ["1.", "Scan the code - it opens the check for this transaction:", false],
    ["", `${verifyBase}?tx=<transaction above>`, true],
    ["2.", "Or upload this PDF on that page. The original receipt file", false],
    ["", "(stele-receipt.json) is attached inside this PDF.", false],
    ["3.", "Or, without any website, with the free open-source tool:", false],
    ["", "npx @stelehq/verifier --tx <transaction above>", true],
  ];
  let sy = top - 4;
  for (const [num, line, mono] of steps) {
    if (num) p.text(M, sy, num, "F2", 9);
    p.text(M + 16, sy, line, mono ? "F3" : "F1", mono ? 8 : 9);
    if (line.startsWith(verifyBase)) p.link(M + 14, sy - 3, 300, 12, verifyTx);
    sy -= 13;
  }
  p.y = Math.min(sy, top - qrSize) - 6;

  p.heading("What this receipt proves - and what it does not");
  for (const line of [
    "Proves: this key accepted exactly this text, in this version, at the time shown.",
    "Proves: nobody - not the company, not Stele - can change the text or the date afterwards.",
    "Proves: it keeps working even if the company's website or Stele disappears.",
    "Does not prove: who the person holding the key is. A signature is not an ID check.",
  ])
    p.para(`- ${line}`, "F1", 8.5, 0, 1);
  p.para(
    "The checks are done against Solana by the verifier. This page is a readable copy; the evidence is the Solana transaction and the attached original receipt.",
    "F1",
    8,
    0,
    6,
  );

  // Footer on every page.
  p.pages.forEach((ops, i) => {
    ops.push(`${LINE} RG 0.6 w ${M} ${M} m ${W - M} ${M} l S`);
    ops.push(
      `BT ${MUTED} rg /F1 7.5 Tf ${M} ${M - 14} Td (${str(
        `Stele - open-source verifier (Apache 2.0): @stelehq/verifier - receipt ${r.acceptanceId.slice(0, 16)}...`,
      )}) Tj ET`,
    );
    ops.push(
      `BT ${MUTED} rg /F1 7.5 Tf ${W - M - 44} ${M - 14} Td (Page ${i + 1} of ${p.pages.length}) Tj ET`,
    );
  });
  return { pages: p.pages, links: p.links };
}

/** Builds the PDF bytes for an acceptance receipt. `verifyBase` is e.g. https://stele.site/verify. */
export function receiptPdf(receipt: PdfReceipt, verifyBase: string): Uint8Array {
  const json = asciiJson(receipt);
  const { pages, links } = layout(receipt, verifyBase);

  // 1 catalog, 2 pages, 3-5 fonts, 6 embedded file, 7 filespec, then (page, content) pairs.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 8 + i * 2);
  objects[1] =
    "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(stele-receipt.json) 7 0 R] >> >> >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";
  objects[6] = `<< /Type /EmbeddedFile /Subtype /application#2Fjson ${MARKER} /Length ${json.length} >>\nstream\n${json}\nendstream`;
  objects[7] = `<< /Type /Filespec /F (stele-receipt.json) /UF (stele-receipt.json) /EF << /F 6 0 R >> /Desc (Stele receipt - verify at ${str(verifyBase)}) >>`;
  pages.forEach((ops, i) => {
    const content = ops.join("\n");
    const id = pageIds[i]!;
    const annots = links[i]!.map(
      ([x, y, w, h, uri]) =>
        `<< /Type /Annot /Subtype /Link /Rect [${x} ${y} ${x + w} ${y + h}] /Border [0 0 0] /A << /S /URI /URI (${str(uri)}) >> >>`,
    );
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Annots [${annots.join(" ")}] /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++)
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info << /Title (Stele acceptance receipt) /Producer (Stele) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** The JSON receipt embedded in a Stele PDF receipt, or null if this is not one. */
export function receiptFromPdf(pdf: string): string | null {
  const at = pdf.indexOf(MARKER);
  if (at < 0) return null;
  const start = pdf.indexOf("stream\n", at);
  const end = pdf.indexOf("\nendstream", start);
  if (start < 0 || end < 0) return null;
  return pdf.slice(start + "stream\n".length, end);
}

/** Saves an acceptance receipt as a PDF in the browser. */
export function downloadReceiptPdf(name: string, receipt: unknown, verifyBase: string) {
  const bytes = receiptPdf(receipt as PdfReceipt, verifyBase);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
