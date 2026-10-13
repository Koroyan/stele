/**
 * PDF receipts: a printable certificate with the full JSON receipt embedded as a file attachment.
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
  organization: { name: string; verifiedDomain: string | null };
  version: {
    title: string;
    label: string;
    number: number;
    versionHash: string;
    publishedAt?: number;
  };
  content?: { blocks: Record<string, unknown>[] };
  fees?: { payer: string; sponsor: string; feeLamports: number };
}

/** The off-chain audit trail: not in the receipt, not checked by the verifier. */
export interface PdfAudit {
  ip?: string | null;
  timeZone?: string | null;
  utcOffsetMinutes?: number | null;
}

// ---- PDF primitives -------------------------------------------------------------------------------

const W = 595;
const H = 842;
const M = 50; // page margin
const COL = M + 132; // value column
const INK = "0.067 0.094 0.125";
const BODY = "0.2 0.235 0.275";
const MUTED = "0.45 0.5 0.55";
const ACCENT = "0.055 0.431 0.549"; // #0E6E8C
const ACCENT_SOFT = "0.91 0.955 0.97";
const RULE = "0.87 0.89 0.91";
const PANEL = "0.965 0.972 0.978";
const OK = "0.114 0.541 0.369"; // #1D8A5E
const NAVY = "0.043 0.067 0.09"; // #0B1117
const SKY = "0.3 0.79 0.94";

type Font = "F1" | "F2" | "F3" | "F4" | "F5"; // Helvetica, -Bold, Courier, Times-Bold, Times-Italic

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
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
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

/** "12 October 2026, 12:23:15" for a UTC instant shifted by `offsetMinutes`. */
function longTime(seconds: number, offsetMinutes = 0): string {
  const d = new Date((seconds + offsetMinutes * 60) * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const m = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Exact time in UTC, plus the signer's local time when their time zone is known. */
function exactTime(seconds: number | null | undefined, audit?: PdfAudit): string[] {
  if (!seconds) return ["-"];
  const out = [`${longTime(seconds)} UTC`];
  if (typeof audit?.utcOffsetMinutes === "number")
    out.push(
      `${longTime(seconds, audit.utcOffsetMinutes)} signer's local time (${
        audit.timeZone ? `${audit.timeZone}, ` : ""
      }${offsetLabel(audit.utcOffsetMinutes)})`,
    );
  return out;
}

/** A simple top-down page writer. */
class Pages {
  readonly pages: string[][] = [[]];
  /** Clickable areas per page: [x, y, w, h, uri]. */
  readonly links: [number, number, number, number, string][][] = [[]];
  y = H - M;
  section = 0;

  private get ops() {
    return this.pages[this.pages.length - 1]!;
  }

  /** Starts a new page when fewer than `need` points remain. */
  ensure(need: number) {
    if (this.y - need < M + 34) {
      this.pages.push([]);
      this.links.push([]);
      this.y = H - M - 10;
    }
  }

  raw(op: string) {
    this.ops.push(op);
  }

  rect(x: number, y: number, w: number, h: number, rgb: string) {
    this.ops.push(`${rgb} rg ${x} ${y} ${w} ${h} re f`);
  }

  frame(x: number, y: number, w: number, h: number, rgb: string, width = 0.7) {
    this.ops.push(`${rgb} RG ${width} w ${x} ${y} ${w} ${h} re S`);
  }

  rule(y: number, rgb = RULE, x1 = M, x2 = W - M) {
    this.ops.push(`${rgb} RG 0.6 w ${x1} ${y} m ${x2} ${y} l S`);
  }

  circle(cx: number, cy: number, r: number, rgb: string, width: number) {
    const k = 0.5523 * r;
    this.ops.push(
      `${rgb} RG ${width} w ${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ` +
        `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ` +
        `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c S`,
    );
  }

  link(x: number, y: number, w: number, h: number, uri: string) {
    this.links[this.links.length - 1]!.push([x, y, w, h, uri]);
  }

  text(x: number, y: number, s: string, font: Font, size: number, rgb = INK, spacing = 0) {
    // Character spacing is part of the text state and outlives ET: always set it.
    this.ops.push(`BT ${rgb} rg /${font} ${size} Tf ${spacing} Tc ${x} ${y} Td (${str(s)}) Tj ET`);
  }

  /** A numbered section heading with an accent rule. */
  heading(title: string) {
    this.ensure(56);
    this.section++;
    this.y -= 22;
    this.text(M, this.y, String(this.section).padStart(2, "0"), "F2", 9, ACCENT);
    this.text(M + 22, this.y, title.toUpperCase(), "F2", 9, INK, 0.8);
    this.y -= 8;
    this.rule(this.y, ACCENT, M, M + 28);
    this.rule(this.y, RULE, M + 28, W - M);
    this.y -= 2;
  }

  /** A label/value row; `mono` values use Courier and wrap at a fixed width. */
  row(label: string, value: string | string[], mono = false, uri?: string) {
    const lines = (Array.isArray(value) ? value : [value]).flatMap((v) =>
      mono ? chunk(v, 68) : words(v, 66),
    );
    this.ensure(15 + lines.length * 12);
    this.y -= 15;
    this.text(M, this.y, label, "F1", 8.5, MUTED);
    lines.forEach((l, i) => {
      if (i > 0) this.y -= 12.5;
      this.text(COL, this.y, l, mono ? "F3" : "F1", mono ? 8.3 : 9.5, uri ? ACCENT : INK);
      if (uri) this.link(COL - 2, this.y - 3, W - M - COL + 2, 12.5, uri);
    });
  }

  /** A paragraph of body text. */
  para(
    s: string,
    font: Font,
    size: number,
    opts: { indent?: number; before?: number; rgb?: string } = {},
  ) {
    const indent = opts.indent ?? 0;
    const lines = words(s, Math.floor((W - 2 * M - indent) / (size * 0.5)));
    this.y -= opts.before ?? 0;
    for (const l of lines) {
      this.ensure(size + 5);
      this.y -= size + 4;
      this.text(M + indent, this.y, l, font, size, opts.rgb ?? BODY);
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
  const cluster = r.network.label.toLowerCase().includes("devnet") ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${r.transaction.signature}${cluster}`;
}

/** The document text, block by block (stele-content-v1), with an accent bar along it. */
function documentText(p: Pages, blocks: Record<string, unknown>[]) {
  p.y -= 6;
  const startPage = p.pages.length;
  const startY = p.y;
  p.y -= 4;
  for (const b of blocks) {
    if (b.type === "heading") {
      const level = Number(b.level) || 1;
      p.para(String(b.text ?? ""), "F4", level === 1 ? 14 : 11, {
        indent: 14,
        before: level === 1 ? 4 : 7,
        rgb: INK,
      });
    } else if (b.type === "paragraph") {
      p.para(String(b.text ?? ""), "F1", 9.3, { indent: 14, before: 3 });
    } else if (b.type === "list" && Array.isArray(b.items)) {
      (b.items as unknown[]).forEach((item, i) =>
        p.para(`${b.ordered ? `${i + 1}.` : "-"}  ${String(item)}`, "F1", 9.3, {
          indent: 24,
          before: i === 0 ? 3 : 1,
        }),
      );
    }
  }
  p.y -= 8;
  if (p.pages.length === startPage) p.rect(M, p.y, 2.5, startY - p.y, ACCENT);
}

function layout(
  r: PdfReceipt,
  verifyBase: string,
  audit?: PdfAudit,
): { pages: string[][]; links: Pages["links"] } {
  const p = new Pages();
  const s = signerOf(r);
  const company = r.organization.name;
  const times = exactTime(r.transaction.blockTime, audit);

  // ---- Header band with the seal.
  p.rect(0, H - 150, W, 150, NAVY);
  p.rect(0, H - 153, W, 3, ACCENT);
  p.rect(M, H - 52, 9, 16, SKY); // the Stele mark: a small monolith
  p.rect(M + 2.5, H - 49, 4, 2, NAVY);
  p.text(M + 16, H - 49, "STELE", "F2", 10.5, "1 1 1", 2);
  p.text(M, H - 92, "Certificate of Acceptance", "F4", 26, "1 1 1");
  p.text(M, H - 114, `Evidence recorded on ${r.network.label}`, "F1", 9.5, "0.72 0.78 0.84");
  p.text(
    M,
    H - 128,
    "Verifiable by anyone, without Stele and without the company",
    "F1",
    9.5,
    "0.72 0.78 0.84",
  );
  const cx = W - M - 46;
  const cy = H - 82;
  p.circle(cx, cy, 42, SKY, 1.4);
  p.circle(cx, cy, 36, SKY, 0.6);
  p.raw(`${SKY} RG 2.2 w ${cx - 9} ${cy + 9} m ${cx - 2} ${cy + 2} l ${cx + 11} ${cy + 17} l S`);
  p.text(cx - 22, cy - 9, "RECORDED", "F2", 7, "1 1 1", 0.6);
  p.text(cx - 20, cy - 19, "ON SOLANA", "F2", 7, "1 1 1", 0.6);
  p.y = H - 170;

  // ---- The statement, in plain words.
  const statement = `On ${times[0]}, the holder of the key below accepted "${r.version.title}" (version ${r.version.label}) published by ${company}.`;
  const sLines = words(statement, 84);
  const boxH = sLines.length * 15 + 34;
  p.rect(M, p.y - boxH, W - 2 * M, boxH, ACCENT_SOFT);
  p.rect(M, p.y - boxH, 3, boxH, ACCENT);
  let ty = p.y - 20;
  for (const l of sLines) {
    p.text(M + 16, ty, l, "F5", 12, INK);
    ty -= 15;
  }
  p.text(
    M + 16,
    ty - 2,
    "The record is on Solana: it cannot be changed or backdated, and stays checkable even if this website disappears.",
    "F1",
    8.3,
    MUTED,
  );
  p.y -= boxH + 4;

  // ---- The document.
  p.heading("The document");
  p.row("Company", company);
  p.row(
    "Company website",
    r.organization.verifiedDomain
      ? `${r.organization.verifiedDomain}  -  ownership verified and recorded on Solana`
      : "Not verified  -  the company has not proven a website",
  );
  p.row("Document", r.version.title);
  p.row("Version", `${r.version.label}  (version #${r.version.number})`);
  if (r.version.publishedAt) p.row("Published", `${longTime(r.version.publishedAt)} UTC`);
  p.row("Digital fingerprint", r.version.versionHash, true);

  // ---- The full text.
  p.heading("Full text of the document");
  if (r.content?.blocks.length) documentText(p, r.content.blocks);
  else p.para("The document text is not included in this receipt.", "F1", 9);
  p.para(
    "This is the exact text that was accepted. Changing even one character would change the digital fingerprint above, which is recorded on Solana.",
    "F1",
    8,
    { before: 2, rgb: MUTED },
  );

  // ---- The signature.
  p.heading("The signature");
  p.row("Signed using", s.kind);
  p.row("Signer's key", s.key, true);
  p.row("Date and time", times);
  p.row("Requested from", r.acceptance.requestDomain);
  if (r.fees)
    p.row(
      "Cost to the signer",
      `Nothing  -  the network fee (${(r.fees.feeLamports / 1e9).toFixed(6)} SOL) was paid by ${
        r.fees.sponsor === "STELE" ? "Stele" : company
      }`,
    );

  // ---- Audit trail (off-chain).
  if (audit && (audit.ip || audit.timeZone)) {
    p.ensure(100); // keep the audit trail on one page
    p.heading("Audit trail");
    p.para(
      "Recorded by Stele's server when the signature was submitted. This part is not on Solana and is not checked by the verifier.",
      "F1",
      8,
      { before: 4, rgb: MUTED },
    );
    if (audit.ip) p.row("IP address", audit.ip, true);
    if (audit.timeZone || typeof audit.utcOffsetMinutes === "number")
      p.row(
        "Device time zone",
        `${audit.timeZone ?? "-"}${
          typeof audit.utcOffsetMinutes === "number"
            ? `  (${offsetLabel(audit.utcOffsetMinutes)})`
            : ""
        }`,
      );
  }

  // ---- Proof on Solana.
  p.heading("Proof on Solana");
  p.row("Network", `${r.network.label}  (${r.network.chainId})`);
  p.row("Transaction", r.transaction.signature, true);
  p.row("View it online", "Open the transaction in Solana Explorer", false, explorerUrl(r));
  if (r.acceptance.signature) p.row("Signature", r.acceptance.signature, true);
  p.row("Receipt ID", r.acceptanceId, true);

  // ---- The message that was signed.
  p.heading("The message that was signed");
  p.para(
    "This short message is what the key actually signed. It names the document by its fingerprint, so it cannot be reused for any other text.",
    "F1",
    8.5,
    { before: 4 },
  );
  const msg = r.acceptance.message.split("\n").flatMap((l) => chunk(l, 90));
  const msgH = msg.length * 10.5 + 18;
  p.ensure(msgH + 12);
  p.y -= 8;
  p.rect(M, p.y - msgH, W - 2 * M, msgH, PANEL);
  p.frame(M, p.y - msgH, W - 2 * M, msgH, RULE, 0.5);
  let my = p.y - 15;
  for (const l of msg) {
    p.text(M + 12, my, l, "F3", 7.8, BODY);
    my -= 10.5;
  }
  p.y -= msgH;

  // ---- How to check, with a QR code to the Verify page for this transaction.
  const verifyTx = `${verifyBase}?tx=${r.transaction.signature}`;
  const qr = QRCode.create(verifyTx, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = 2.1;
  const qrSize = n * cell;
  p.heading("How anyone can check this");
  const boxQ = qrSize + 30;
  p.ensure(boxQ + 16);
  p.y -= 10;
  const top = p.y;
  p.frame(M, top - boxQ, W - 2 * M, boxQ, RULE, 0.6);
  const qx = W - M - 14 - qrSize;
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++)
      if (qr.modules.get(row, col))
        p.rect(qx + col * cell, top - 12 - (row + 1) * cell, cell + 0.15, cell + 0.15, INK);
  p.link(qx, top - 12 - qrSize, qrSize, qrSize, verifyTx);
  p.text(qx + qrSize / 2 - 22, top - boxQ + 7, "Scan to verify", "F1", 7, MUTED);
  const steps: [string, string, string?][] = [
    ["1", "Scan the code. It opens the check for this exact transaction."],
    [
      "2",
      "Or upload this PDF on the Verify page. The original receipt",
      "(stele-receipt.json) is attached inside this PDF.",
    ],
    [
      "3",
      "Or check it with no website at all, using the free",
      "open-source tool:  npx @stelehq/verifier",
    ],
  ];
  let sy = top - 26;
  for (const [num, a, b] of steps) {
    p.circle(M + 21, sy + 3, 7, ACCENT, 0.8);
    p.text(M + 18.6, sy, num, "F2", 8, ACCENT);
    p.text(M + 36, sy, a, "F1", 9, INK);
    if (b) {
      sy -= 12;
      p.text(M + 36, sy, b, "F1", 9, INK);
    }
    sy -= 20;
  }
  p.text(M + 36, top - boxQ + 12, verifyBase.replace(/^https?:\/\//, ""), "F3", 8, ACCENT);
  p.link(M + 34, top - boxQ + 8, 200, 12, verifyTx);
  p.y = top - boxQ;

  // ---- What this proves.
  p.heading("What this certificate proves");
  for (const [mark, line] of [
    ["+", "This key accepted exactly this text, in this version, at the time shown."],
    ["+", "Nobody - not the company, not Stele - can change the text or the time afterwards."],
    ["+", "It keeps working even if the company's website or Stele disappears."],
    ["-", "It does not prove who holds the key: a signature is not an identity check."],
  ] as const) {
    p.ensure(14);
    p.y -= 14;
    p.text(M + 2, p.y, mark, "F2", 10, mark === "+" ? OK : MUTED);
    p.text(M + 16, p.y, line, "F1", 9, BODY);
  }
  p.para(
    "This document is a readable copy. The evidence is the Solana transaction and the attached original receipt, which the verifier re-checks.",
    "F1",
    8,
    { before: 8, rgb: MUTED },
  );

  // ---- Footer on every page.
  const total = p.pages.length;
  p.pages.forEach((ops, i) => {
    ops.push(`${RULE} RG 0.6 w ${M} ${M} m ${W - M} ${M} l S`);
    ops.push(
      `BT ${MUTED} rg /F1 7.3 Tf 0 Tc ${M} ${M - 14} Td (${str(
        `Stele  -  Certificate of Acceptance  -  Receipt ${r.acceptanceId.slice(0, 20)}...  -  verify: ${verifyBase.replace(/^https?:\/\//, "")}`,
      )}) Tj ET`,
    );
    ops.push(
      `BT ${MUTED} rg /F1 7.3 Tf 0 Tc ${W - M - 42} ${M - 14} Td (Page ${i + 1} of ${total}) Tj ET`,
    );
  });
  return { pages: p.pages, links: p.links };
}

/** Builds the PDF bytes for an acceptance receipt. `verifyBase` is e.g. https://stele.site/verify. */
export function receiptPdf(receipt: PdfReceipt, verifyBase: string, audit?: PdfAudit): Uint8Array {
  const json = asciiJson(receipt);
  const { pages, links } = layout(receipt, verifyBase, audit);

  // 1 catalog, 2 pages, 3-7 fonts, 8 embedded file, 9 filespec, then (page, content) pairs.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 10 + i * 2);
  objects[1] =
    "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(stele-receipt.json) 9 0 R] >> >> >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  const font = (name: string) =>
    `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  objects[3] = font("Helvetica");
  objects[4] = font("Helvetica-Bold");
  objects[5] = font("Courier");
  objects[6] = font("Times-Bold");
  objects[7] = font("Times-Italic");
  objects[8] = `<< /Type /EmbeddedFile /Subtype /application#2Fjson ${MARKER} /Length ${json.length} >>\nstream\n${json}\nendstream`;
  objects[9] = `<< /Type /Filespec /F (stele-receipt.json) /UF (stele-receipt.json) /EF << /F 8 0 R >> /Desc (Original Stele receipt - verify at ${str(verifyBase)}) >>`;
  pages.forEach((ops, i) => {
    const content = ops.join("\n");
    const id = pageIds[i]!;
    const annots = links[i]!.map(
      ([x, y, w, h, uri]) =>
        `<< /Type /Annot /Subtype /Link /Rect [${x} ${y} ${x + w} ${y + h}] /Border [0 0 0] /A << /S /URI /URI (${str(uri)}) >> >>`,
    );
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 7 0 R >> >> /Annots [${annots.join(" ")}] /Contents ${id + 1} 0 R >>`;
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
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info << /Title (Certificate of Acceptance - ${str(receipt.version.title)}) /Author (Stele) /Producer (Stele) >> >>\nstartxref\n${xref}\n%%EOF\n`;
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
export function downloadReceiptPdf(
  name: string,
  receipt: unknown,
  verifyBase: string,
  audit?: PdfAudit | null,
) {
  const bytes = receiptPdf(receipt as PdfReceipt, verifyBase, audit ?? undefined);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
