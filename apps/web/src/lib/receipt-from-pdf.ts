/**
 * Stele PDF certificates carry the original JSON receipt as an attachment, stored uncompressed
 * and marked, so it can be read back without a PDF library. Only that receipt is verified; the
 * PDF's visible text is a readable copy.
 */
const MARKER = "/SteleReceipt true";

/** The JSON receipt embedded in a Stele PDF receipt, or null if this is not one. */
export function receiptFromPdf(pdf: string): string | null {
  const at = pdf.indexOf(MARKER);
  if (at < 0) return null;
  const start = /stream\r?\n/.exec(pdf.slice(at));
  if (!start) return null;
  const from = at + start.index + start[0].length;
  const end = pdf.indexOf("endstream", from);
  if (end < 0) return null;
  return pdf.slice(from, end).replace(/\r?\n$/, "");
}

/** Saves a blob as a file in the browser. */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
