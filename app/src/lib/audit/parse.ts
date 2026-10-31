import { isSameSite, normalizeUrl } from "./url";

/**
 * A small, forgiving HTML extractor for the site audit. It tokenizes the markup in one pass
 * (tags, attributes, comments, raw-text elements such as <script> and <style>, character
 * references) and collects only what the checks need; no DOM is built, so a 3 MB page is parsed
 * in a few milliseconds with no dependency. Broken markup never throws: unknown constructs are
 * treated as text, unclosed raw-text elements run to the end of the document.
 */

export interface ParsedHtml {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  headings: [number, number, number, number, number, number];
  canonical: string | null;
  canonicalCount: number;
  robotsMeta: string;
  lang: string;
  viewport: boolean;
  charset: string;
  wordCount: number;
  internalLinks: string[];
  externalLinks: string[];
  linksTotal: number;
  nofollowLinks: number;
  imagesTotal: number;
  imagesWithoutAlt: number;
  imagesWithoutSize: number;
  images: Array<{ src: string; alt: string | null; width: string | null; height: string | null }>;
  scripts: number;
  styles: number;
  mixedContent: string[];
  hreflang: Array<{ lang: string; href: string }>;
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  jsonLd: Array<{ valid: boolean; types: string[] }>;
  favicon: boolean;
}

export const LIMITS = {
  internalLinks: 300,
  externalLinks: 100,
  images: 30,
  mixedContent: 50,
  hreflang: 100,
  jsonLd: 20,
  socialTags: 30,
  text: 300,
} as const;

// ── Character references ──

const NAMED: Record<string, number> = {
  amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, nbsp: 160, copy: 169, reg: 174, trade: 8482, hellip: 8230,
  mdash: 8212, ndash: 8211, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222,
  laquo: 171, raquo: 187, bull: 8226, middot: 183, euro: 8364, pound: 163, yen: 165, cent: 162, deg: 176,
  times: 215, divide: 247, para: 182, sect: 167, shy: 173, iexcl: 161, iquest: 191, ensp: 8194, emsp: 8195,
  thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, aacute: 225, eacute: 233, iacute: 237,
  oacute: 243, uacute: 250, agrave: 224, egrave: 232, igrave: 236, ograve: 242, ugrave: 249, acirc: 226,
  ecirc: 234, icirc: 238, ocirc: 244, ucirc: 251, auml: 228, euml: 235, iuml: 239, ouml: 246, uuml: 252,
  atilde: 227, otilde: 245, ntilde: 241, ccedil: 231, szlig: 223, aring: 229, aelig: 230, oslash: 248,
  Aacute: 193, Eacute: 201, Iacute: 205, Oacute: 211, Uacute: 218, Auml: 196, Ouml: 214, Uuml: 220,
  Ntilde: 209, Ccedil: 199, Aring: 197, AElig: 198, Oslash: 216,
};

function fromCode(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return String.fromCharCode(0xfffd);
  return String.fromCodePoint(code);
}

/** Decode character references (&amp; &#39; &#x27; &eacute; …). Unknown names are left as they are. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (match, ref: string) => {
    if (ref[0] === "#") return fromCode(ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1)));
    const code = NAMED[ref] ?? NAMED[ref.toLowerCase()];
    return code ? String.fromCodePoint(code) : match;
  });
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number = LIMITS.text) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// ── Tokenizer ──

type Attrs = Map<string, string>;

interface Handlers {
  start(name: string, attrs: Attrs, selfClosing: boolean): void;
  end(name: string): void;
  text(text: string): void;
  /** Content of a raw-text / RCDATA element (script, style, title, textarea…). */
  raw(name: string, attrs: Attrs, content: string): void;
}

const RAW_TEXT = new Set(["script", "style", "title", "textarea", "xmp", "noembed", "noframes"]);
const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

/** Calls `h` for every token of `html`. */
export function tokenize(html: string, h: Handlers): void {
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      h.text(html.slice(i));
      break;
    }
    if (lt > i) h.text(html.slice(i, lt));
    const next = html[lt + 1];
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (next === "/") {
      const m = /^<\/([A-Za-z][^\s/>]*)[^>]*>?/.exec(html.slice(lt, lt + 300));
      if (m) {
        h.end(m[1].toLowerCase());
        // A very long end tag: skip to its ">".
        if (!m[0].endsWith(">")) {
          const end = html.indexOf(">", lt);
          i = end === -1 ? n : end + 1;
        } else i = lt + m[0].length;
      } else {
        h.text("<");
        i = lt + 1;
      }
      continue;
    }
    if (!next || !/[A-Za-z]/.test(next)) {
      h.text("<");
      i = lt + 1;
      continue;
    }
    // Start tag: name, then attributes.
    let j = lt + 1;
    while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">") j++;
    const name = html.slice(lt + 1, j).toLowerCase();
    const attrs: Attrs = new Map();
    let selfClosing = false;
    while (j < n) {
      while (j < n && (isSpace(html[j]) || html[j] === "/")) {
        if (html[j] === "/") selfClosing = html[j + 1] === ">";
        j++;
      }
      if (j >= n) break;
      if (html[j] === ">") {
        j++;
        break;
      }
      selfClosing = false;
      const nameStart = j;
      while (j < n && !isSpace(html[j]) && html[j] !== "=" && html[j] !== ">" && !(html[j] === "/" && html[j + 1] === ">")) j++;
      const attrName = html.slice(nameStart, j).toLowerCase();
      while (j < n && isSpace(html[j])) j++;
      let value = "";
      if (html[j] === "=") {
        j++;
        while (j < n && isSpace(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, j + 1);
          const stop = close === -1 ? n : close;
          value = html.slice(j + 1, stop);
          j = close === -1 ? n : close + 1;
        } else {
          const vs = j;
          while (j < n && !isSpace(html[j]) && html[j] !== ">") j++;
          value = html.slice(vs, j);
        }
      }
      if (attrName && !attrs.has(attrName)) attrs.set(attrName, decodeEntities(value));
    }
    i = j;
    if (RAW_TEXT.has(name) && !selfClosing) {
      const re = new RegExp(`</${name}[\\s/>]`, "ig");
      re.lastIndex = i;
      const m = re.exec(html);
      const contentEnd = m ? m.index : n;
      const content = html.slice(i, contentEnd);
      h.start(name, attrs, false);
      h.raw(name, attrs, content);
      h.end(name);
      if (m) {
        const gt = html.indexOf(">", m.index);
        i = gt === -1 ? n : gt + 1;
      } else i = n;
      continue;
    }
    h.start(name, attrs, selfClosing);
  }
}

// ── Words ──

const SCRIPT_CHARS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu;

/** Words of a text; each Chinese / Japanese / Thai… character counts as one word (no spaces between words). */
export function countWords(text: string): number {
  let n = 0;
  const rest = text.replace(SCRIPT_CHARS, () => {
    n++;
    return " ";
  });
  return n + (rest.match(WORD)?.length ?? 0);
}

// ── Extraction ──

const IGNORED_TEXT = new Set(["noscript", "template", "svg", "math"]);
const MEDIA_SRC = new Set(["img", "script", "iframe", "video", "audio", "source", "embed", "track", "input"]);

function relTokens(attrs: Attrs): string[] {
  return (attrs.get("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** JSON-LD @type values (also inside @graph and nested objects), at most 20. */
function jsonLdTypes(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8 || out.size >= 20 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) jsonLdTypes(item, out, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  const type = obj["@type"];
  if (typeof type === "string") out.add(clip(type, 60));
  else if (Array.isArray(type)) for (const t of type) if (typeof t === "string") out.add(clip(t, 60));
  for (const [key, v] of Object.entries(obj)) if (key !== "@context" && v && typeof v === "object") jsonLdTypes(v, out, depth + 1);
}

/**
 * Everything the audit needs from one HTML page. `pageUrl` is the final URL (after redirects),
 * `siteHost` the crawled host (links to it, with or without "www.", are internal).
 */
export function parseHtml(html: string, pageUrl: string, siteHost: string): ParsedHtml {
  const out: ParsedHtml = {
    title: null,
    metaDescription: null,
    h1: [],
    headings: [0, 0, 0, 0, 0, 0],
    canonical: null,
    canonicalCount: 0,
    robotsMeta: "",
    lang: "",
    viewport: false,
    charset: "",
    wordCount: 0,
    internalLinks: [],
    externalLinks: [],
    linksTotal: 0,
    nofollowLinks: 0,
    imagesTotal: 0,
    imagesWithoutAlt: 0,
    imagesWithoutSize: 0,
    images: [],
    scripts: 0,
    styles: 0,
    mixedContent: [],
    hreflang: [],
    openGraph: {},
    twitterCard: {},
    jsonLd: [],
    favicon: false,
  };
  let base: string = pageUrl;
  let baseSet = false;
  const https = pageUrl.startsWith("https:");
  const internal = new Set<string>();
  const external = new Set<string>();
  const mixed = new Set<string>();
  const robots: string[] = [];
  const text: string[] = [];
  let textLength = 0;
  let ignoredDepth = 0;
  let svgDepth = 0;
  let h1Depth = 0;
  let h1Text: string[] = [];

  const resolve = (href: string | undefined) => (href ? normalizeUrl(href, base) : null);
  const checkMixed = (raw: string | undefined) => {
    if (!https || !raw || mixed.size >= LIMITS.mixedContent) return;
    const url = resolve(raw);
    if (url?.startsWith("http:")) mixed.add(url);
  };

  tokenize(html, {
    start(name, attrs, selfClosing) {
      if (IGNORED_TEXT.has(name) && !selfClosing) {
        ignoredDepth++;
        if (name === "svg" || name === "math") svgDepth++;
      }
      switch (name) {
        case "html":
          if (!out.lang) out.lang = clip((attrs.get("lang") ?? attrs.get("xml:lang") ?? "").trim(), 35);
          break;
        case "base":
          if (!baseSet && attrs.get("href")) {
            const b = normalizeUrl(attrs.get("href")!, pageUrl);
            if (b) base = b;
            baseSet = true;
          }
          break;
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          out.headings[Number(name[1]) - 1]++;
          if (name === "h1") {
            h1Depth++;
            if (h1Depth === 1) h1Text = [];
          }
          break;
        case "meta": {
          const content = attrs.get("content") ?? "";
          const metaName = (attrs.get("name") ?? "").trim().toLowerCase();
          const property = (attrs.get("property") ?? "").trim().toLowerCase();
          if (attrs.has("charset")) out.charset ||= clip(attrs.get("charset")!.trim(), 40);
          if ((attrs.get("http-equiv") ?? "").toLowerCase() === "content-type") out.charset ||= clip(content.replace(/^.*charset=/i, "").trim(), 40);
          if (metaName === "description" && out.metaDescription === null) out.metaDescription = clip(collapse(content), 500);
          else if (metaName === "robots" || metaName === "googlebot" || metaName === "searchzenbot") {
            if (content.trim()) robots.push(content.trim().toLowerCase());
          } else if (metaName === "viewport") out.viewport = content.trim().length > 0;
          const key = property.startsWith("og:") ? property : metaName.startsWith("og:") ? metaName : "";
          if (key && !(key in out.openGraph) && Object.keys(out.openGraph).length < LIMITS.socialTags) out.openGraph[key] = clip(collapse(content));
          const tKey = metaName.startsWith("twitter:") ? metaName : property.startsWith("twitter:") ? property : "";
          if (tKey && !(tKey in out.twitterCard) && Object.keys(out.twitterCard).length < LIMITS.socialTags) out.twitterCard[tKey] = clip(collapse(content));
          break;
        }
        case "link": {
          const rel = relTokens(attrs);
          const href = attrs.get("href");
          if (rel.includes("canonical")) {
            out.canonicalCount++;
            if (out.canonical === null && href !== undefined) out.canonical = resolve(href) ?? clip(href.trim(), 1000);
          }
          if (rel.includes("alternate") && attrs.has("hreflang") && out.hreflang.length < LIMITS.hreflang) {
            out.hreflang.push({ lang: clip((attrs.get("hreflang") ?? "").trim(), 35), href: resolve(href) ?? "" });
          }
          if (rel.some((r) => r === "icon" || r === "apple-touch-icon" || r === "mask-icon")) out.favicon = true;
          if (rel.includes("stylesheet")) {
            out.styles++;
            checkMixed(href);
          } else if (rel.some((r) => r === "icon" || r === "preload" || r === "modulepreload" || r === "apple-touch-icon")) checkMixed(href);
          break;
        }
        case "a":
        case "area": {
          const url = resolve(attrs.get("href"));
          if (!url) break;
          out.linksTotal++;
          if (isSameSite(url, siteHost)) {
            if (relTokens(attrs).includes("nofollow")) out.nofollowLinks++;
            if (internal.size < LIMITS.internalLinks && url !== pageUrl) internal.add(url);
          } else if (external.size < LIMITS.externalLinks) external.add(url);
          break;
        }
        case "img": {
          out.imagesTotal++;
          const alt = attrs.has("alt") ? attrs.get("alt")! : null;
          if (alt === null || !alt.trim()) out.imagesWithoutAlt++;
          const width = attrs.get("width") ?? null;
          const height = attrs.get("height") ?? null;
          if (!width || !height) out.imagesWithoutSize++;
          const src = attrs.get("src") ?? attrs.get("data-src") ?? "";
          if (out.images.length < LIMITS.images) out.images.push({ src: resolve(src) ?? clip(src, 300), alt: alt === null ? null : clip(collapse(alt)), width, height });
          checkMixed(attrs.get("src"));
          break;
        }
        case "object":
          checkMixed(attrs.get("data"));
          break;
        default:
          if (MEDIA_SRC.has(name) && name !== "script") {
            if (name !== "input" || (attrs.get("type") ?? "").toLowerCase() === "image") checkMixed(attrs.get("src"));
          }
      }
    },
    end(name) {
      if (IGNORED_TEXT.has(name) && ignoredDepth > 0) {
        ignoredDepth--;
        if ((name === "svg" || name === "math") && svgDepth > 0) svgDepth--;
      }
      if (name === "h1" && h1Depth > 0) {
        h1Depth--;
        if (h1Depth === 0) out.h1.push(clip(collapse(h1Text.join(""))));
      }
    },
    text(chunk) {
      if (h1Depth > 0) h1Text.push(decodeEntities(chunk));
      if (ignoredDepth > 0 || textLength > 2_000_000) return;
      text.push(chunk);
      textLength += chunk.length;
    },
    raw(name, attrs, content) {
      if (name === "title") {
        // An SVG icon's <title> is not the document title.
        if (out.title === null && svgDepth === 0) out.title = clip(collapse(decodeEntities(content)), 500);
        return;
      }
      if (name === "style") {
        out.styles++;
        return;
      }
      if (name === "script") {
        const type = (attrs.get("type") ?? "").trim().toLowerCase();
        if (type === "application/ld+json") {
          if (out.jsonLd.length < LIMITS.jsonLd) {
            try {
              const parsed: unknown = JSON.parse(content.trim());
              const types = new Set<string>();
              jsonLdTypes(parsed, types);
              out.jsonLd.push({ valid: true, types: [...types] });
            } catch {
              out.jsonLd.push({ valid: false, types: [] });
            }
          }
          return;
        }
        if (!type || type === "module" || type.includes("javascript") || type.includes("ecmascript")) {
          out.scripts++;
          checkMixed(attrs.get("src"));
        }
        return;
      }
      if (name === "textarea" && ignoredDepth === 0) text.push(content);
    },
  });

  // An <h1> that is never closed.
  if (h1Depth > 0) out.h1.push(clip(collapse(h1Text.join(""))));
  out.robotsMeta = clip([...new Set(robots)].join(", "), 250);
  out.internalLinks = [...internal];
  out.externalLinks = [...external];
  out.mixedContent = [...mixed];
  out.wordCount = countWords(decodeEntities(text.join(" ")));
  return out;
}
