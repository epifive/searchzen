import { normalizeDevice, normalizeTags } from "@/seo/normalize";
import type { KeywordInput } from "@/seo/types";

/** CSV import / export of keywords (dependency-free). */

/** Byte order mark: written first so spreadsheet apps read the file as UTF-8. */
const BOM = 0xfeff;

/** RFC 4180 parser: quoted fields, "" escapes, CRLF / LF; separator "," or ";" (detected), BOM stripped. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === BOM ? input.slice(1) : input;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const HEADER_ALIASES: Record<string, keyof KeywordInput> = {
  keyword: "phrase",
  keywords: "phrase",
  phrase: "phrase",
  query: "phrase",
  country: "country",
  gl: "country",
  language: "language",
  hl: "language",
  device: "device",
  location: "location",
  city: "location",
  tags: "tags",
  tag: "tags",
  target_url: "targetUrl",
  "target url": "targetUrl",
  url: "targetUrl",
};

const DEFAULT_COLUMNS: Array<keyof KeywordInput> = ["phrase", "country", "language", "device", "location", "tags", "targetUrl"];

/**
 * Keywords from CSV rows. With a header row (keyword, country, language, device, location,
 * tags, target_url in any order) columns are matched by name; without one they are read in
 * that order. Tags inside a cell are separated by "|" or ",". Empty cells use the defaults.
 */
export function keywordsFromCsv(text: string, max = 5000): KeywordInput[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => HEADER_ALIASES[h] === "phrase");
  const columns = hasHeader ? header.map((h) => HEADER_ALIASES[h]) : DEFAULT_COLUMNS;
  const out: KeywordInput[] = [];
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const input: KeywordInput = { phrase: "" };
    row.forEach((cell, i) => {
      const col = columns[i];
      const value = cell.trim();
      if (!col || !value) return;
      if (col === "tags") input.tags = normalizeTags(value.split(/[|,;]+/));
      else if (col === "device") input.device = normalizeDevice(value.toLowerCase());
      else if (col === "targetUrl") input.targetUrl = value;
      else input[col] = value;
    });
    if (input.phrase) out.push(input);
    if (out.length >= max) break;
  }
  return out;
}

/** A CSV cell: quoted when needed; cells starting with = + - @ get a leading ' (spreadsheet formula injection). */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return `${String.fromCharCode(BOM)}${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
