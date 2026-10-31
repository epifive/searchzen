import type { AuditCheck } from "@/seo/types";
import { dupKey, htmlOk, indexable, pageCheck, textLength } from "./helpers";

/** On-page content: titles, meta descriptions, headings, text length and image alt text. */

export const TITLE_MIN = 30;
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;
export const THIN_WORDS = 200;

function duplicateOf(map: Map<string, string[]>, value: string | null | undefined, url: string): false | { count: number; url: string } {
  const key = dupKey(value);
  if (!key) return false;
  const urls = map.get(key);
  if (!urls || urls.length < 2) return false;
  return { count: urls.length, url: urls.find((u) => u !== url) ?? urls[0] };
}

export const CONTENT_CHECKS: AuditCheck[] = [
  pageCheck("title_missing", "critical", "content", (p) => htmlOk(p) && !p.title?.trim()),
  pageCheck("title_short", "notice", "content", (p) => htmlOk(p) && Boolean(p.title?.trim()) && textLength(p.title!.trim()) < TITLE_MIN && { length: textLength(p.title!.trim()) }),
  pageCheck("title_long", "notice", "content", (p) => htmlOk(p) && Boolean(p.title) && textLength(p.title!.trim()) > TITLE_MAX && { length: textLength(p.title!.trim()) }),
  pageCheck("title_duplicate", "warning", "content", (p, ctx) => indexable(p) && duplicateOf(ctx.duplicateTitles, p.title, p.url)),
  pageCheck("meta_desc_missing", "warning", "content", (p) => htmlOk(p) && !p.metaDescription?.trim()),
  pageCheck(
    "meta_desc_short",
    "notice",
    "content",
    (p) => htmlOk(p) && Boolean(p.metaDescription?.trim()) && textLength(p.metaDescription!.trim()) < DESCRIPTION_MIN && { length: textLength(p.metaDescription!.trim()) },
  ),
  pageCheck(
    "meta_desc_long",
    "notice",
    "content",
    (p) => htmlOk(p) && Boolean(p.metaDescription) && textLength(p.metaDescription!.trim()) > DESCRIPTION_MAX && { length: textLength(p.metaDescription!.trim()) },
  ),
  pageCheck("meta_desc_duplicate", "warning", "content", (p, ctx) => indexable(p) && duplicateOf(ctx.duplicateDescriptions, p.metaDescription, p.url)),
  pageCheck("h1_missing", "warning", "content", (p) => htmlOk(p) && p.headings[0] === 0),
  pageCheck("h1_multiple", "notice", "content", (p) => htmlOk(p) && p.headings[0] > 1 && { count: p.headings[0] }),
  pageCheck("h1_duplicate", "notice", "content", (p, ctx) => indexable(p) && duplicateOf(ctx.duplicateH1, p.h1[0], p.url)),
  pageCheck("thin_content", "warning", "content", (p) => indexable(p) && p.wordCount < THIN_WORDS && { words: p.wordCount }),
  pageCheck("img_alt_missing", "warning", "content", (p) => htmlOk(p) && p.imagesWithoutAlt > 0 && { count: p.imagesWithoutAlt, total: p.imagesTotal }),
];
