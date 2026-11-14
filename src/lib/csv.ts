/**
 * CSV helpers shared by the transaction export and the tax-year export.
 *
 * Money stays integer cents until this boundary (AGENTS.md); `csvCents` is the
 * one place a CSV turns cents into dollars.
 */

/** Leading characters a spreadsheet treats as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell. Values a spreadsheet would evaluate as a formula (`=`, `+`,
 * `-`, `@`, tab, CR — OWASP "CSV injection") get a leading `'` so they open as
 * text: transaction names and notes come from banks and users, and an
 * accountant opening the file should never run one. Then the usual RFC 4180
 * quoting for commas, quotes and line breaks.
 */
export function csvEscape(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Integer cents → "-12.50". Numeric cells are emitted unescaped so they stay numbers. */
export function csvCents(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  return dollars === "-0.00" ? "0.00" : dollars;
}

/** Escape and join text cells. Pre-formatted numeric cells (csvCents, counts) pass through `raw`. */
export function csvRow(cells: (string | { raw: string })[]): string {
  return cells.map((c) => (typeof c === "string" ? csvEscape(c) : c.raw)).join(",");
}

/** Lines → file bytes, with a UTF-8 BOM so Excel reads accents correctly. */
export function csvDocumentBytes(lines: string[]): Uint8Array {
  const csvBytes = new TextEncoder().encode(lines.join("\n") + "\n");
  const body = new Uint8Array(3 + csvBytes.length);
  body.set([0xef, 0xbb, 0xbf], 0);
  body.set(csvBytes, 3);
  return body;
}

/** A download response for a CSV built with `csvDocumentBytes`. */
export function csvDownloadResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
