import { hostMatches } from "@/seo/normalize";
import type { SerpCheckInput, SerpFeature, SerpResult } from "@/seo/types";
import type { OrganicItem, ProviderResult, RankProvider } from "../parse";

/**
 * Simulated provider (testing and the live demo only — never real Google data).
 *
 * Deterministic per keyword and UTC day: the same keyword checked twice on the same day gets the
 * same results, so checks are reproducible and idempotent. Positions follow a smooth random walk
 * (slow swings plus weekly noise) with occasional jumps; some keywords never rank, and ranking
 * ones sometimes drop out for a day. Ranking URLs are plausible pages on the project's domain
 * (occasionally switching to another page), competitors get their own walks, and the rest of
 * the page is filled with well-known sites.
 *
 * `simulateSerp()` is exported so the demo seed can generate months of history with the same
 * model the scheduled checks use afterwards.
 */

const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2020, 0, 1);

/** FNV-1a 32-bit hash. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Uniform number in [0, 1) for a seed and a label (stateless, so any day can be computed directly). */
function rnd(seed: string, label: string | number): number {
  let t = (hash(`${seed}#${label}`) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const dayIndex = (day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - EPOCH) / DAY_MS);

/** Smooth noise in [-1, 1]: random values every `step` days, eased in between. */
function valueNoise(seed: string, d: number, step: number): number {
  const k = Math.floor(d / step);
  const f = (d - k * step) / step;
  const s = f * f * (3 - 2 * f);
  const a = rnd(seed, `n${k}`) * 2 - 1;
  const b = rnd(seed, `n${k + 1}`) * 2 - 1;
  return a + (b - a) * s;
}

/**
 * Position of one domain for one keyword on one day, before the depth cut (may exceed 100).
 * null = not ranking at all that day.
 */
function walk(seed: string, d: number, options: { neverShare: number }): number | null {
  const tier = rnd(seed, "tier");
  // Some keywords never reach the top 100.
  if (tier < options.neverShare) return 101 + Math.floor(rnd(seed, `far${d}`) * 60);
  const r = rnd(seed, "base");
  const base = r < 0.33 ? 1 + r * 27 : r < 0.7 ? 10 + (r - 0.33) * 55 : 30 + (r - 0.7) * 160;
  const period = 50 + rnd(seed, "period") * 110;
  const phase = rnd(seed, "phase") * Math.PI * 2;
  const swing = base * (0.15 + rnd(seed, "swing") * 0.3) * Math.sin((2 * Math.PI * d) / period + phase);
  const noise = Math.max(1.2, base * 0.18) * valueNoise(seed, d, 7);
  const segment = Math.floor(d / 40);
  let jump = 0;
  for (let i = segment - 2; i <= segment; i++) {
    if (rnd(seed, `jump${i}`) < 0.22) jump += (rnd(seed, `jumpsize${i}`) - 0.55) * base * 0.7 * (i === segment ? 1 : 0.4);
  }
  const jitter = rnd(seed, `j${d}`) < 0.3 ? (rnd(seed, `jd${d}`) < 0.5 ? -1 : 1) : 0;
  if (rnd(seed, `drop${d}`) < 0.02) return null;
  const pos = Math.round(base + swing + noise + jump + jitter);
  return Math.max(1, pos);
}

const FILLERS: Array<[domain: string, site: string]> = [
  ["en.wikipedia.org", "Wikipedia"],
  ["reddit.com", "Reddit"],
  ["youtube.com", "YouTube"],
  ["medium.com", "Medium"],
  ["forbes.com", "Forbes"],
  ["nytimes.com", "The New York Times"],
  ["hubspot.com", "HubSpot"],
  ["quora.com", "Quora"],
  ["amazon.com", "Amazon"],
  ["linkedin.com", "LinkedIn"],
  ["pinterest.com", "Pinterest"],
  ["github.com", "GitHub"],
  ["stackoverflow.com", "Stack Overflow"],
  ["investopedia.com", "Investopedia"],
  ["techradar.com", "TechRadar"],
  ["theverge.com", "The Verge"],
  ["nerdwallet.com", "NerdWallet"],
  ["g2.com", "G2"],
  ["capterra.com", "Capterra"],
  ["zapier.com", "Zapier"],
  ["shopify.com", "Shopify"],
  ["wordpress.org", "WordPress.org"],
  ["semrush.com", "Semrush"],
  ["ahrefs.com", "Ahrefs"],
  ["moz.com", "Moz"],
  ["backlinko.com", "Backlinko"],
  ["searchenginejournal.com", "Search Engine Journal"],
  ["neilpatel.com", "Neil Patel"],
  ["wired.com", "WIRED"],
  ["cnet.com", "CNET"],
  ["bbc.co.uk", "BBC"],
  ["theguardian.com", "The Guardian"],
  ["indeed.com", "Indeed"],
  ["yelp.com", "Yelp"],
  ["tripadvisor.com", "Tripadvisor"],
  ["etsy.com", "Etsy"],
  ["healthline.com", "Healthline"],
  ["webmd.com", "WebMD"],
  ["businessinsider.com", "Business Insider"],
  ["entrepreneur.com", "Entrepreneur"],
];
const TLDS = [".com", ".net", ".co"];
const WORDS = ["best", "top", "smart", "daily", "pro", "hub", "guide", "lab", "point", "world", "central", "insider", "review", "zone", "base", "hq"];

const FEATURE_SHARE: Record<SerpFeature, number> = {
  featured_snippet: 0.25,
  local_pack: 0.14,
  ai_overview: 0.38,
  people_also_ask: 0.62,
  images: 0.3,
  videos: 0.24,
  top_stories: 0.1,
  shopping: 0.12,
  sitelinks: 0.3,
  knowledge_panel: 0.12,
};

const slugify = (phrase: string) =>
  phrase
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "page";
const titleCase = (phrase: string) => phrase.replace(/(^|\s)(\p{L})/gu, (_, s: string, c: string) => s + c.toUpperCase());

/** A page of `domain` for the keyword (stable, with an occasional switch to another page). */
function pageUrl(seed: string, domain: string, phrase: string, d: number): string {
  const slug = slugify(phrase);
  const paths = [`/${slug}`, `/blog/${slug}`, `/guides/${slug}`, `/products/${slug}`, "/"];
  let pick = Math.floor(rnd(seed, "url") * 4);
  if (rnd(seed, `urlswitch${Math.floor(d / 45)}`) < 0.15) pick = (pick + 1 + Math.floor(rnd(seed, `urlalt${Math.floor(d / 45)}`) * 3)) % paths.length;
  return `https://${domain}${paths[pick]}`;
}

/** The phrase contains the site's name ("northwind outdoor" for northwindoutdoor.com, accents and spaces ignored). */
function isBrandSearch(phrase: string, domain: string): boolean {
  const compact = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const name = compact(domain.split(".")[0] ?? "");
  return name.length >= 5 && compact(phrase).includes(name);
}

/** A result in the making: its host is known (no URL parsing needed). */
type Slot = OrganicItem & { domain: string; filler: boolean };

/** Bare host of a domain as domainOf() reports it for an https://<domain>/ URL. */
const hostOf = (domain: string) => domain.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");

/** What doesn't change from day to day for a keyword (cached: the demo seed computes months of days). */
interface Prepared {
  phraseTitle: string;
  slug: string;
  brand: boolean;
  /** Filler sites in their original order, with the fixed part of their score. */
  fillers: Array<{ domain: string; site: string; base: number; style: number }>;
}

const prepared = new Map<string, Prepared>();

function prepare(input: SerpCheckInput, kw: string): Prepared {
  const key = `${kw}#${input.domain}#${input.competitors.join(",")}`;
  const cached = prepared.get(key);
  if (cached) return cached;
  const slug = slugify(input.phrase);
  const taken = [input.domain, ...input.competitors];
  const fillers = [
    ...FILLERS,
    ...Array.from({ length: 30 }, (_, i) => {
      const a = WORDS[Math.floor(rnd(kw, `w1${i}`) * WORDS.length)];
      const b = slug.split("-")[Math.floor(rnd(kw, `w2${i}`) * 3)] || "web";
      const domain = `${b}${a}${TLDS[Math.floor(i / WORDS.length) % TLDS.length]}`;
      return [domain, titleCase(`${b} ${a}`)] as [string, string];
    }),
  ]
    .filter(([domain], i, all) => all.findIndex(([d]) => d === domain) === i)
    .filter(([domain]) => !taken.some((t) => hostMatches(domain, t) || hostMatches(t, domain)))
    .map(([domain, site]) => ({ domain, site, base: rnd(kw, domain) * 10, style: Math.floor(rnd(kw, `${domain}style`) * 3) }));
  const value: Prepared = { phraseTitle: titleCase(input.phrase), slug, brand: isBrandSearch(input.phrase, input.domain), fillers };
  if (prepared.size >= 1000) prepared.clear();
  prepared.set(key, value);
  return value;
}

/** Results page for a keyword on a UTC day ("YYYY-MM-DD"). Pure and deterministic. */
export function simulateSerp(input: SerpCheckInput, day: string): ProviderResult {
  const d = dayIndex(day);
  const kw = [input.phrase, input.country, input.language, input.device, input.location.toLowerCase()].join("|");
  const { phraseTitle, slug, brand, fillers } = prepare(input, kw);
  const depth = input.depth;
  const slots: Array<Slot | null> = Array(depth).fill(null);
  const place = (pos: number | null, item: Slot) => {
    if (pos === null || pos > depth) return;
    let i = pos - 1;
    while (i < depth && slots[i]) i++;
    if (i < depth) slots[i] = item;
  };
  // Brand searches (the phrase contains the site's name) find the homepage at the top.
  const own = brand ? (rnd(kw, `brand${d}`) < 0.9 ? 1 : 2) : walk(`${kw}|${input.domain}`, d, { neverShare: 0.12 });
  place(own, { url: brand ? `https://${input.domain}/` : pageUrl(`${kw}|${input.domain}`, input.domain, input.phrase, d), title: `${phraseTitle} | ${input.domain}`, domain: hostOf(input.domain), filler: false });
  for (const c of input.competitors) {
    const seed = `${kw}|${c}`;
    place(walk(seed, d, { neverShare: 0.25 }), { url: pageUrl(seed, c, input.phrase, d), title: `${phraseTitle}: the complete guide - ${c}`, domain: hostOf(c), filler: false });
  }
  // Fillers: a keyword-specific order of well-known sites (plus made-up niche sites), lightly reshuffled per day.
  const candidates = fillers.map((c) => ({ c, score: c.base + rnd(kw, `${c.domain}${d}`) * 1.2 })).sort((a, b) => a.score - b.score);
  const year = new Date(Date.parse(`${day}T00:00:00Z`)).getUTCFullYear();
  let next = 0;
  for (let i = 0; i < depth && next < candidates.length; i++) {
    if (slots[i]) continue;
    const { c } = candidates[next++];
    const title = c.style === 0 ? `${phraseTitle} - ${c.site}` : c.style === 1 ? `The 10 Best ${phraseTitle} (${year})` : `What is ${phraseTitle}? | ${c.site}`;
    slots[i] = { url: `https://${c.domain}/${slug}${c.style === 2 ? "/" : ""}`, title, domain: c.domain, filler: true };
  }
  const features: SerpFeature[] = [];
  for (const [f, share] of Object.entries(FEATURE_SHARE) as Array<[SerpFeature, number]>) {
    // Searches in a city usually show a map with local businesses; brand searches sitelinks.
    let on = rnd(kw, `f-${f}`) < (f === "local_pack" && input.location ? 0.8 : f === "sitelinks" && brand ? 0.9 : share);
    if (rnd(kw, `f-${f}-${Math.floor(d / 5)}`) < 0.12) on = !on;
    if (on) features.push(f);
  }
  // Number the results like ResultCollector (src/lib/serp/parse.ts) does, without parsing every URL:
  // the hosts are known, and fillers never match the project's or a competitor's domain.
  const results: SerpResult[] = [];
  const seen = new Set<string>();
  let position: number | null = null;
  let url: string | null = null;
  const competitors = new Map<string, number | null>(input.competitors.map((c) => [c, null]));
  for (const slot of slots) {
    if (!slot || !slot.domain) continue;
    if (results.length >= depth) break;
    const bare = slot.url.includes("#") ? slot.url.slice(0, slot.url.indexOf("#")) : slot.url;
    const key = bare.endsWith("/") ? bare.slice(0, -1) : bare;
    if (seen.has(key)) continue;
    seen.add(key);
    const pos = results.length + 1;
    results.push({ position: pos, url: slot.url, title: slot.title.trim().slice(0, 300), domain: slot.domain });
    if (slot.filler) continue;
    if (position === null && hostMatches(slot.domain, input.domain)) {
      position = pos;
      url = slot.url;
    }
    for (const [c, p] of competitors) if (p === null && hostMatches(slot.domain, c)) competitors.set(c, pos);
  }
  return { position, url, features, competitors: Object.fromEntries(competitors), results, credits: 0, requests: 1 };
}

export function createSimulatedProvider(options: { now?: () => number } = {}): RankProvider {
  return {
    id: "simulated",
    name: "Simulated (testing only)",
    async check(input: SerpCheckInput) {
      const day = new Date(options.now ? options.now() : Date.now()).toISOString().slice(0, 10);
      return simulateSerp(input, day);
    },
  };
}
