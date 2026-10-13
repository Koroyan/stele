/**
 * PDF receipts: a printable summary with the full JSON receipt embedded as a file attachment.
 *
 * The PDF is only a carrier. Verification never trusts what the PDF says: the Verify page extracts
 * the embedded JSON receipt and re-checks every claim against Solana, exactly as for a .json file.
 * The PDF is written by hand (no dependency): plain ASCII, Helvetica, uncompressed streams, so the
 * embedded receipt can be found again with a simple scan.
 */
import type { Receipt } from "@stelehq/protocol";

const MARKER = "/SteleReceipt true";
const PAGE_LINES = 62;
const WRAP = 104;

/** JSON with every non-ASCII character escaped, so the PDF stays pure ASCII (byte = char). */
function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Text for a PDF string literal: ASCII only, with (, ) and \ escaped. */
function pdfText(s: string): string {
  return s
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(line: string): string[] {
  if (line.length <= WRAP) return [line];
  const out: string[] = [];
  for (let i = 0; i < line.length; i += WRAP) out.push(line.slice(i, i + WRAP));
  return out;
}

function iso(seconds: number | null | undefined): string {
  return seconds ? new Date(seconds * 1000).toISOString().replace(".000Z", "Z") : "-";
}

/** The human-readable lines of the receipt. */
function lines(r: Receipt, verifyUrl: string): string[] {
  const out = [
    "STELE ACCEPTANCE RECEIPT",
    "",
    `Organization:   ${r.organization.name}${r.organization.verifiedDomain ? ` (verified domain: ${r.organization.verifiedDomain})` : ""}`,
    `Document:       ${r.version.title} - version ${r.version.label} (#${r.version.number})`,
    `Fingerprint:    ${r.version.versionHash}`,
    `Signer:         ${r.acceptance.signer}`,
    `Recorded:       ${iso(r.transaction.blockTime)} on ${r.network.label}`,
    `Transaction:    ${r.transaction.signature}`,
    `Acceptance ID:  ${r.acceptanceId}`,
    `Requested by:   ${r.acceptance.requestDomain}`,
    "",
    "EXACT MESSAGE SIGNED",
    "",
    ...r.acceptance.message.split("\n"),
    "",
    "HOW TO VERIFY (no trust in Stele needed)",
    "",
    `1. Upload this PDF at ${verifyUrl} - the verifier runs in your browser and re-checks`,
    "   every claim against Solana. The full receipt (stele-receipt.json) is attached to this PDF.",
    "2. Or from the command line, with the open-source verifier:",
    `   npx @stelehq/verifier --rpc <SOLANA RPC> --program ${r.network.programId} \\`,
    `     --expect-chain ${r.network.chainId} --tx ${r.transaction.signature}`,
    "",
    "This receipt proves that this key signed the exact message above, recorded on Solana. It does",
    "not by itself identify the person who controls the key. The text of this PDF is a summary:",
    "the evidence is the transaction on Solana and the attached receipt.",
  ];
  return out.flatMap(wrap);
}

/** Builds the PDF bytes for a receipt. */
export function receiptPdf(receipt: Receipt, verifyUrl: string): Uint8Array {
  const json = asciiJson(receipt);
  const text = lines(receipt, verifyUrl);
  const pages: string[][] = [];
  for (let i = 0; i < text.length; i += PAGE_LINES) pages.push(text.slice(i, i + PAGE_LINES));

  // Object numbers: 1 catalog, 2 pages, 3 font, 4 bold font, 5 embedded file, 6 filespec,
  // then a (page, content) pair per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 7 + i * 2);
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(stele-receipt.json) 6 0 R] >> >> /PageMode /UseAttachments >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
  objects[5] = `<< /Type /EmbeddedFile /Subtype /application#2Fjson ${MARKER} /Length ${json.length} >>\nstream\n${json}\nendstream`;
  objects[6] = `<< /Type /Filespec /F (stele-receipt.json) /UF (stele-receipt.json) /EF << /F 5 0 R >> /Desc (Stele receipt - verify at ${pdfText(verifyUrl)}) >>`;
  pages.forEach((page, i) => {
    const ops = ["BT", "/F1 8 Tf", "10.5 TL", "48 800 Td"];
    page.forEach((line, n) => {
      const heading = i === 0 && n === 0;
      ops.push(heading ? "/F2 14 Tf" : "/F1 8 Tf");
      ops.push(`(${pdfText(line)}) Tj T*`);
      if (heading) ops.push("T*");
    });
    ops.push("ET");
    const content = ops.join("\n");
    objects[pageIds[i]!] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
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
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
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

/** Saves a receipt as a PDF in the browser. */
export function downloadReceiptPdf(name: string, receipt: Receipt, verifyUrl: string) {
  const bytes = receiptPdf(receipt, verifyUrl);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
