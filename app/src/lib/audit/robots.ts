/**
 * robots.txt parser and matcher following Google's rules (RFC 9309), used by the site audit
 * crawler and its robots.txt checks:
 * - the crawler obeys the group with the most specific matching user-agent (groups naming the
 *   same agent are merged), falling back to "*";
 * - the longest matching rule wins; on a tie, Allow wins;
 * - "*" matches any sequence of characters and a trailing "$" anchors the end.
 * Also reads Sitemap: lines and the Crawl-delay of the group that applies.
 */

export interface ParsedRule {
  type: "allow" | "disallow";
  path: string;
}

export interface ParsedGroup {
  agents: string[];
  rules: ParsedRule[];
  /** Crawl-delay in seconds (null = not set). */
  crawlDelay: number | null;
}

export interface ParsedRobots {
  groups: ParsedGroup[];
  sitemaps: string[];
  /** Lines that are neither empty, comments nor known directives. */
  unknownLines: number;
  /** Lines with a recognised directive. */
  directives: number;
}

const MAX_LINES = 20_000;
const KNOWN = new Set(["user-agent", "allow", "disallow", "sitemap", "crawl-delay", "host", "noindex", "clean-param", "request-rate", "visit-time"]);

/** The crawler's robots.txt product token. */
export const ROBOTS_AGENT = "SearchzenBot";

/** Lower-cased product token: the leading letters, "_" and "-" of a user-agent name. */
export function productToken(agent: string): string {
  return (agent.trim().match(/^[a-z_-]+/i)?.[0] ?? "").toLowerCase();
}

export function parseRobots(text: string): ParsedRobots {
  const groups: ParsedGroup[] = [];
  const sitemaps: string[] = [];
  let current: ParsedGroup | null = null;
  let collectingAgents = false;
  let unknownLines = 0;
  let directives = 0;

  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const raw of body.split(/\r\n|\r|\n/).slice(0, MAX_LINES)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    const key = colon > 0 ? line.slice(0, colon).trim().toLowerCase() : "";
    if (!KNOWN.has(key)) {
      unknownLines++;
      continue;
    }
    directives++;
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      if (value) current.agents.push(value);
      collectingAgents = true;
      continue;
    }
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    collectingAgents = false;
    if ((key === "allow" || key === "disallow") && current && value) current.rules.push({ type: key, path: value });
    if (key === "crawl-delay" && current) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups: groups.filter((g) => g.agents.length), sitemaps: [...new Set(sitemaps)].slice(0, 20), unknownLines, directives };
}

function agentKey(agent: string): string {
  return agent.trim() === "*" ? "*" : productToken(agent);
}

/** The merged groups that apply to a crawler: an exact token match beats a "token-…" family match, which beats "*". */
function groupsFor(parsed: ParsedRobots, userAgent: string): ParsedGroup[] {
  const token = productToken(userAgent);
  let best: { score: number; key: string } | null = null;
  for (const group of parsed.groups) {
    for (const agent of group.agents) {
      const key = agentKey(agent);
      let score = -1;
      if (key === "*") score = 0;
      else if (key && key === token) score = Number.MAX_SAFE_INTEGER;
      else if (key && token.startsWith(`${key}-`)) score = key.length;
      if (score >= 0 && (!best || score > best.score)) best = { score, key };
    }
  }
  if (!best) return [];
  const key = best.key;
  return parsed.groups.filter((g) => g.agents.some((a) => agentKey(a) === key));
}

function encodeChar(char: string): string {
  try {
    return encodeURIComponent(char);
  } catch {
    return "%EF%BF%BD";
  }
}

function normalizePath(path: string): string {
  return path.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase()).replace(/[^\x21-\x7E]/gu, encodeChar);
}

const patternCache = new Map<string, RegExp>();

export function patternMatches(pattern: string, path: string): boolean {
  let re = patternCache.get(pattern);
  if (!re) {
    const normalized = normalizePath(pattern);
    const anchored = normalized.endsWith("$");
    const body = anchored ? normalized.slice(0, -1) : normalized;
    re = new RegExp(`^${body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
    if (patternCache.size > 5000) patternCache.clear();
    patternCache.set(pattern, re);
  }
  return re.test(normalizePath(path));
}

/** A compiled matcher for one user agent. */
export interface RobotsMatcher {
  allowed(pathWithQuery: string): boolean;
  /** Crawl-delay of the applying group, seconds (0 = none). */
  crawlDelay: number;
  /** "Disallow: /" without an Allow rule that re-opens anything. */
  disallowAll: boolean;
}

export function robotsMatcher(parsed: ParsedRobots, userAgent: string = ROBOTS_AGENT): RobotsMatcher {
  const groups = groupsFor(parsed, userAgent);
  const rules = groups.flatMap((g) => g.rules);
  const crawlDelay = Math.max(0, ...groups.map((g) => g.crawlDelay ?? 0));
  const disallowAll = rules.some((r) => r.type === "disallow" && (r.path === "/" || r.path === "/*")) && !rules.some((r) => r.type === "allow" && r.path.length > 1);
  return {
    crawlDelay,
    disallowAll,
    allowed(pathWithQuery: string) {
      const target = pathWithQuery || "/";
      if (target === "/robots.txt" || !rules.length) return true;
      let winner: ParsedRule | null = null;
      for (const rule of rules) {
        if (!patternMatches(rule.path, target)) continue;
        if (!winner || rule.path.length > winner.path.length || (rule.path.length === winner.path.length && rule.type === "allow" && winner.type === "disallow")) {
          winner = rule;
        }
      }
      return !winner || winner.type === "allow";
    },
  };
}

/** A robots.txt answer is usable: plain text, not an HTML error page, mostly directives. */
export function robotsLooksValid(text: string, contentType: string, parsed: ParsedRobots): boolean {
  if (/html/i.test(contentType) || /^\s*<(!doctype|html|head|body)/i.test(text)) return false;
  if (!text.trim()) return true;
  return parsed.directives > 0 && parsed.unknownLines <= parsed.directives;
}
