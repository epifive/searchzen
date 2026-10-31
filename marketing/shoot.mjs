// Captures marketing screenshots of a running Searchzen instance with headless Chrome (CDP).
//
//   node shoot.mjs [baseUrl] [outDir] [only]
//
// baseUrl  default http://localhost:5500 (a production build seeded with DEMO_SEED=true)
// outDir   default ./raw
// only     optional comma list of name prefixes, e.g. "l,d03" (l = landing, u = sign-in pages,
//          d = dashboard, m = mobile, r = Arabic / Hindi, a = admin, i = installer)
//
// Sign-in: SHOT_EMAIL / SHOT_PASSWORD (default demo@searchzen.app / demo12345). The installer shot
// needs a second, not installed server: SHOT_INSTALL_URL (e.g. http://localhost:5501). The Chrome
// profile is created under the system temp folder (SHOT_TMP) and removed afterwards.
// SZ_DB points at the demo's SQLite file (default /tmp/sz-mkt/storage/db.sqlite):
// two shots change it for a moment and put it back (see "Temporary database changes" below).
//
// Recipe used for the images in marketing/final:
//   cd ../app
//   NEXT_DIST_DIR=.next-mkt npx next build            (without DEMO_SEED in the environment!)
//   STORAGE_DIR=/tmp/sz-mkt/storage APP_INSTALLED=true DB_DRIVER=sqlite DB_FILE=db.sqlite
//   ADMIN_EMAIL=demo@searchzen.app ADMIN_PASSWORD=demo12345 ADMIN_NAME="Demo Admin"
//   SITE_URL=http://localhost:5500 CRON_SECRET=testsecret-long-1 DEMO_SEED=true DEMO_MODE=true
//   NEXT_DIST_DIR=.next-mkt npx next start -p 5500      (the first request seeds the demo)
//   node demo-extras.mjs, then restart the server        (channels, API keys, SMTP, a share password …)
//   optional installer: STORAGE_DIR=<empty folder> NEXT_DIST_DIR=.next-mkt npx next start -p 5501
//   node shoot.mjs && node render.mjs && python finalize.py
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { launch, sleep } from "./lib/cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || "http://localhost:5500").replace(/\/$/, "");
const OUT = path.resolve(process.argv[3] || path.join(HERE, "raw"));
const ONLY = (process.argv[4] ?? "").split(",").filter(Boolean);
const EMAIL = process.env.SHOT_EMAIL ?? "demo@searchzen.app";
const PASSWORD = process.env.SHOT_PASSWORD ?? "demo12345";
const INSTALL_URL = process.env.SHOT_INSTALL_URL ?? "";
const DB_FILE = process.env.SZ_DB ?? "/tmp/sz-mkt/storage/db.sqlite";
const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA busy_timeout = 10000");
const one = (sql, ...args) => db.prepare(sql).get(...args);

const NW = one("SELECT id, share_token FROM projects WHERE name = 'Northwind Outdoor'");
const ACME = one("SELECT id, share_token FROM projects WHERE name = 'Acme Cloud'");
const P = "/dashboard/projects/" + NW.id;
const REPORT = "/r/" + one("SELECT value FROM settings WHERE key = 'showcase_report_token'").value;
// "2 person backpacking tent": 35 → 7 over the 90-day campaign, ranked at every check.
const KEYWORD = one("SELECT id FROM keywords WHERE project_id = ? AND phrase = '2 person backpacking tent'", NW.id)?.id ?? 7;
const LAST_AUDIT = one("SELECT id FROM audits WHERE project_id = ? AND status = 'done' ORDER BY id DESC", NW.id).id;
const AUDIT_PAGE = one("SELECT id FROM audit_pages WHERE audit_id = ? AND url LIKE '%/products/backcountry-leather-boot'", LAST_AUDIT)?.id;

// What the screenshots show instead of the local demo addresses (display only, nothing is saved).
const PUBLIC_URL = "https://seo.example.com";
// The demo's "simulated test data" notice in English and the bundled Arabic and Hindi packs.
const SIMULATED = [
  "Positions here are simulated test data, not real Google rankings.",
  ...["ar", "hi"].map((c) => JSON.parse(fs.readFileSync(path.join(HERE, "../app/languages", c + ".json"), "utf8")).translations?.["rank.notice.simulated"] ?? ""),
];
const HOST = new URL(BASE).host;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\:/]/g, "\\$&");
const SWAPS = [
  [new RegExp(esc(process.env.STORAGE_DIR ?? "/tmp/sz-mkt/storage") + '[^\\s"]*', "g"), "/var/www/searchzen/storage"],
  [/testsecret-long-1/g, "k3J9xQ2mV7pL5wR8"],
  [new RegExp(esc(EMAIL), "g"), "alex@example.com"],
  [new RegExp("https?://" + esc(HOST), "g"), PUBLIC_URL],
  [new RegExp(esc(HOST), "g"), new URL(PUBLIC_URL).host],
];

fs.mkdirSync(OUT, { recursive: true });
const { send, waitFor, evaluate, close, errors } = await launch();

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");

let current = { width: 1440, height: 900, mobile: false, scale: 1 };
async function viewport(width, height, { mobile = false, scale = 1 } = {}) {
  current = { width, height, mobile, scale };
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
}
let media = "";
async function scheme(dark) {
  await send("Emulation.setEmulatedMedia", { media, features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "no-preference" }] });
}
async function lang(code) {
  await send("Network.setCookie", { name: "tz_lang", value: code, url: BASE + "/" });
}
async function theme(t) {
  await evaluate(`localStorage.setItem('tz-theme', '${t}'); true`);
  await scheme(t === "dark");
}
async function go(url, settle = 1800) {
  const loaded = waitFor("Page.loadEventFired");
  await send("Page.navigate", { url: url.startsWith("http") || url.startsWith("file:") ? url : BASE + url });
  await loaded;
  await evaluate("document.fonts.ready.then(() => true)");
  await sleep(settle);
  await prep();
}

// Hide scrollbars, the cookie notice and the demo-mode notices, finish entrance animations and
// swap the local demo addresses for public-looking ones (text only, nothing is saved).
async function prep() {
  await evaluate(`(() => {
    if (!document.getElementById('sz-shot')) {
      const s = document.createElement('style'); s.id = 'sz-shot';
      s.textContent = 'html{scrollbar-width:none} ::-webkit-scrollbar{display:none} nextjs-portal{display:none!important} main > p.bg-marker:first-child{display:none!important}';
      document.head.appendChild(s);
    }
    // Demo mode's "simulated test data" notice above the rank tracking pages (en, ar, hi).
    const simulated = ${JSON.stringify(SIMULATED)};
    document.querySelectorAll('[role=status]').forEach((el) => { if (simulated.includes(el.textContent.trim())) el.remove(); });
    // Demo-mode notice on the sign-in page.
    document.querySelectorAll('[role=status], [role=alert]').forEach((el) => { if (/\\bdemo\\b|Live demo/i.test(el.textContent) && el.closest('form')) el.remove(); });
    return true; })()`);
  await settleAnimations();
  await brandify();
}
async function settleAnimations() {
  // Finite animations jump to their end; looping ones (pulse, ping) are paused at a good frame.
  await evaluate(`(() => { document.getAnimations().forEach((a) => { const t = a.effect?.getTiming?.(); if (!t) return;
    if (t.iterations !== Infinity) { try { a.finish(); } catch {} return; }
    a.pause(); a.currentTime = /ping/.test(a.animationName || '') ? 250 : 0; }); return true; })()`);
}
async function brandify() {
  const swaps = SWAPS.map(([re, to]) => [re.source, re.flags, to]);
  await evaluate(`(() => {
    const swaps = ${JSON.stringify(swaps)}.map(([s, f, t]) => [new RegExp(s, f), t]);
    const swap = (v) => swaps.reduce((acc, [re, t]) => acc.replace(re, t), v);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) { const v = swap(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
    document.querySelectorAll('input, textarea').forEach((el) => { if (el.value && el.type !== 'hidden') { const v = swap(el.value); if (v !== el.value) el.value = v; } if (el.placeholder) el.placeholder = swap(el.placeholder); });
    return true; })()`);
}

async function shot(name, { full = false, clip, height } = {}) {
  await sleep(150);
  const params = { format: "png" };
  if (full || height) {
    const h = height ?? (await evaluate("Math.ceil(document.documentElement.scrollHeight)"));
    params.clip = { x: 0, y: 0, width: current.width, height: h, scale: 1 };
    params.captureBeyondViewport = true;
  } else if (clip) {
    params.clip = { ...clip, scale: 1 };
    params.captureBeyondViewport = true;
  }
  const { data } = await send("Page.captureScreenshot", params);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log("saved", name);
}
// Tall screenshot: grow the viewport to the page height first, so sticky sidebars fill it.
async function tall(name, maxHeight = 6000, minHeight = 900) {
  const h = Math.max(minHeight, Math.min(maxHeight, await evaluate("Math.ceil(document.documentElement.scrollHeight)")));
  const keep = { ...current };
  await viewport(current.width, h, { mobile: current.mobile, scale: current.scale });
  await sleep(900);
  await settleAnimations();
  await brandify();
  await shot(name);
  await viewport(keep.width, keep.height, keep);
  return h;
}
// Tall screenshot that ends `pad` px below the element matched by the JS expression `bottomOf`.
async function tallTo(name, bottomOf, pad = 24, minHeight = 900) {
  const h = await evaluate("Math.ceil(document.documentElement.scrollHeight)");
  const keep = { ...current };
  await viewport(current.width, h, { mobile: current.mobile, scale: current.scale });
  await sleep(900);
  await settleAnimations();
  await brandify();
  const bottom = await evaluate(`(() => { const el = ${bottomOf}; return el ? Math.ceil(el.getBoundingClientRect().bottom + scrollY) : 0; })()`);
  // Shrink the viewport to the picture so fixed/sticky parts (sidebar footer) sit at its bottom.
  const target = bottom ? Math.max(minHeight, Math.min(h, bottom + pad)) : h;
  await viewport(current.width, target, { mobile: current.mobile, scale: current.scale });
  await sleep(700);
  await settleAnimations();
  await brandify();
  await shot(name);
  await viewport(keep.width, keep.height, keep);
}
// Scroll so the element matched by `selectorExpr` starts `offset` px below the top of the viewport.
async function scrollToEl(selectorExpr, offset = 24) {
  const ok = await evaluate(`(() => { const el = ${selectorExpr}; if (!el) return false; scrollTo(0, el.getBoundingClientRect().top + scrollY - ${offset}); return true; })()`);
  if (!ok) console.warn("  (element not found for scroll)");
  await sleep(500);
  await settleAnimations();
  await brandify();
}
// A landing-page section (by id or by the id of its heading), full width, with the whole page
// laid out in one tall viewport so scroll-triggered reveals have all run.
async function sectionShot(name, selector, { padTop = 0, padBottom = 0 } = {}) {
  const h = await evaluate("Math.ceil(document.documentElement.scrollHeight)");
  const keep = { ...current };
  await viewport(current.width, h, { mobile: current.mobile, scale: current.scale });
  await sleep(1000);
  await settleAnimations();
  await brandify();
  const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const s = el?.closest('section'); if (!s) return null; const r = s.getBoundingClientRect(); return { y: Math.floor(r.top + scrollY), h: Math.ceil(r.height) }; })()`);
  if (!box) console.warn("  section not found", name);
  else await shot(name, { clip: { x: 0, y: Math.max(0, box.y - padTop), width: current.width, height: box.h + padTop + padBottom } });
  await viewport(keep.width, keep.height, keep);
}
// The home page hero down to the end of the proof strip under it (or 900 px).
async function heroShot(name) {
  const strip = await evaluate(`(() => { const el = document.querySelector('main section[aria-labelledby=hero-title]')?.nextElementSibling; return el && el.tagName === 'SECTION' && !el.id ? Math.ceil(el.getBoundingClientRect().bottom) : Math.ceil(document.querySelector('main section')?.getBoundingClientRect().bottom ?? 0); })()`);
  await viewport(1440, strip > 700 && strip < 1150 ? strip : 900);
  await sleep(600);
  await settleAnimations();
  await shot(name);
  await viewport(1440, 900);
}
// The content column from the top of the card around heading `fromRe` to the bottom of the card
// around heading `toRe` (dashboard pages: everything right of the sidebar).
async function cardsShot(name, fromRe, toRe, pad = 20) {
  const h = await evaluate("Math.ceil(document.documentElement.scrollHeight)");
  const keep = { ...current };
  await viewport(current.width, h, { mobile: current.mobile, scale: current.scale });
  await sleep(900);
  await settleAnimations();
  await brandify();
  const box = await evaluate(`(() => { const a = ${card(fromRe)}; const b = ${card(toRe)}; if (!a || !b) return null; const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return { x: Math.floor(ra.left), y: Math.floor(ra.top + scrollY), w: Math.ceil(ra.width), b: Math.ceil(rb.bottom + scrollY) }; })()`);
  if (!box) console.warn("  cards not found", name);
  else await shot(name, { clip: { x: box.x - pad, y: box.y - pad, width: box.w + 2 * pad, height: box.b - box.y + 2 * pad } });
  await viewport(keep.width, keep.height, keep);
}
const want = (name) => !ONLY.length || ONLY.some((p) => name.startsWith(p) || p.startsWith(name));

async function login(loginPath, email, password) {
  await go(loginPath, 1000);
  await evaluate(`(() => { const set = (n, v) => { const el = document.querySelector('input[name=' + n + ']'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('email', ${JSON.stringify(email)}); set('password', ${JSON.stringify(password)}); document.querySelector('form button[type=submit]').click(); return true; })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const p = await evaluate("location.pathname");
    if (p !== loginPath) return p;
  }
  throw new Error("login failed: " + loginPath);
}
const clickText = (selector, re) =>
  evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => ${re}.test(x.textContent.trim())); el?.click(); return !!el; })()`);
// The panel / card (rounded box) around the heading whose text matches `re`.
const card = (re) => `(() => { const h = [...document.querySelectorAll('h1,h2,h3')].find((x) => ${re}.test(x.textContent.trim())); let c = h; while (c && c.parentElement && !/rounded/.test(c.className?.baseVal ?? c.className ?? '')) c = c.parentElement; return c; })()`;
const heading = (re) => `[...document.querySelectorAll('h1,h2,h3')].find((x) => ${re}.test(x.textContent.trim()))`;
// Fill text inputs for a nicer picture (the form is never submitted).
const fill = (pairs) =>
  evaluate(`(() => { for (const [sel, v] of ${JSON.stringify(pairs)}) { const el = document.querySelector(sel); if (!el) continue; el.removeAttribute('disabled'); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    if (el.type === 'checkbox') el.checked = !!v; else Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); }
    return true; })()`);
const PHONE = { mobile: true, scale: 2 };

// ── Temporary database changes (put back right after the shot) ──
// A crawl in progress on Northwind: an audit row leased far into the future (locked_until), so
// neither the scheduler nor the page's progress polls ever crawl anything, plus queued URLs.
function addRunningAudit() {
  const done = one("SELECT settings, pages_limit FROM audits WHERE id = ?", LAST_AUDIT);
  const nowIso = new Date().toISOString();
  const started = new Date(Date.now() - 4 * 60_000).toISOString();
  const lease = new Date(Date.now() + 3600_000).toISOString();
  const r = db
    .prepare("INSERT INTO audits (project_id, status, triggered_by, settings, started_at, finished_at, pages_crawled, pages_limit, score, issues_summary, error, locked_until, created_at, updated_at) VALUES (?, 'crawling', 'manual', ?, ?, NULL, 87, ?, NULL, ?, NULL, ?, ?, ?)")
    .run(NW.id, done.settings, started, done.pages_limit, JSON.stringify({ critical: 0, warning: 0, notice: 0, byCode: {}, pagesWithCritical: 0, pagesWithIssues: 0 }), lease, started, nowIso);
  const id = Number(r.lastInsertRowid);
  const q = db.prepare("INSERT INTO audit_queue (audit_id, url, url_hash, depth, found_on, state, attempts, created_at) VALUES (?, ?, ?, 2, NULL, 'pending', 0, ?)");
  for (let i = 0; i < 38; i++) q.run(id, `https://northwindoutdoor.example/queued-${i}`, `shot-${id}-${i}`, nowIso);
  return id;
}
function removeRunningAudit(id) {
  db.prepare("DELETE FROM audit_queue WHERE audit_id = ?").run(id);
  db.prepare("DELETE FROM audits WHERE id = ?").run(id);
}
// Admin → Settings → Rank tracking with Serper.dev selected (its fake key comes from
// demo-extras.mjs). Cleared right after the shot, so demo mode goes back to the Simulated provider.
function setProvider(value) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('serp_provider', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
}

try {
  await viewport(1440, 900);
  await scheme(false);
  await go("/", 300);
  await evaluate("localStorage.setItem('sz-cookie-consent','1'); localStorage.setItem('tz-theme','light'); true");
  await lang("en");

  // ── Landing (signed out) ──
  if (want("l")) {
    if (want("l01")) {
      await go("/", 2500);
      await heroShot("l01-home-hero");
    }
    if (want("l02")) {
      await go("/", 1500);
      await evaluate(`(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); return true; })()`);
      await sleep(1200);
      await tall("l02-home-full", 16000);
    }
    const sections = [
      ["l03-how-it-works", "#how-it-works"],
      ["l04-features", "#features"],
      ["l05-audit-showcase", "#audit"],
      ["l06-report-showcase", "#reports"],
      ["l07-integrations", "#integrations"],
      ["l08-pricing-teaser", "#pricing-title"],
      ["l09-faq", "#faq"],
    ];
    if (sections.some(([n]) => want(n))) {
      await go("/", 2000);
      for (const [name, sel] of sections) if (want(name)) await sectionShot(name, sel, name === "l07-integrations" ? { padTop: 72, padBottom: -40 } : {});
    }
    if (want("l10")) {
      await theme("dark");
      await go("/", 2500);
      await heroShot("l10-home-dark");
      await sectionShot("l10b-audit-dark", "#audit");
      await theme("light");
    }
    if (want("l11")) {
      await go("/pricing", 1500);
      await tall("l11-pricing", 2200);
    }
    for (const [name, code] of [["l12-home-hi", "hi"], ["l13-home-ar", "ar"]]) {
      if (!want(name)) continue;
      await lang(code);
      await go("/", 2500);
      await heroShot(name);
      await lang("en");
    }
  }

  // ── Public report, password gate (signed out) ──
  if (want("p")) {
    if (want("p1")) {
      await go(REPORT, 2500);
      await shot("p1-public-report");
      await tall("p1b-public-report-full", 7000);
      // The site audit and Search Console part of the report.
      const top = await evaluate(`(() => { const h = ${heading("/^Latest site audit$/")}; let c = h; while (c && c.parentElement && !/rounded/.test(c.className ?? '')) c = c.parentElement; return c ? Math.floor(c.getBoundingClientRect().top + scrollY) - 40 : 0; })()`);
      if (top) {
        await viewport(1440, 7000);
        await sleep(800);
        await settleAnimations();
        await brandify();
        await shot("p1c-public-report-audit-gsc", { clip: { x: 0, y: top, width: 1440, height: Math.min(1700, (await evaluate("document.documentElement.scrollHeight")) - top) } });
        await viewport(1440, 900);
      }
    }
    if (want("p2")) {
      // Print emulation at A4 width (794 CSS px), what "Download PDF" (the browser's print dialog) lays out.
      media = "print";
      await scheme(false);
      await viewport(794, 1123);
      await go(REPORT, 2500);
      await tall("p2-public-report-print", 9000, 1123);
      media = "";
      await scheme(false);
      await viewport(1440, 900);
    }
    if (want("p3") && ACME.share_token) {
      await go("/r/" + ACME.share_token, 1500);
      await shot("p3-report-password");
    }
  }

  if (want("u")) {
    if (want("u1")) {
      await go("/login", 1200);
      await shot("u1-login");
    }
  }
  if (want("m1")) {
    await viewport(390, 844, PHONE);
    await go("/", 2500);
    await shot("m1-home");
    await go(REPORT, 2500);
    await shot("m4-public-report");
    await viewport(1440, 900);
  }

  // ── Dashboard ──
  const needLogin = ["d", "m", "r", "a"].some((p) => ONLY.length === 0 || ONLY.some((o) => o.startsWith(p) && o !== "m1"));
  if (needLogin) console.log("login ->", await login("/login", EMAIL, PASSWORD));

  if (want("d")) {
    if (want("d01")) {
      await go("/dashboard", 2000);
      await shot("d01-projects");
    }
    if (want("d02")) {
      await go(P, 2500);
      await shot("d02-overview-30");
      await tall("d02b-overview-full", 2600);
      await go(P + "?days=90", 2500);
      await shot("d02c-overview-90");
    }
    if (want("d03")) {
      await go(P + "/rankings", 2500);
      await shot("d03-rankings");
      await go(P + "/rankings?sort=c30", 2500);
      await scrollToEl(card("/^Keywords$/"), 24);
      await shot("d03b-rankings-table");
      await tall("d03c-rankings-full", 6000);
    }
    if (want("d04")) {
      await go(P + "/rankings?tag=blog&sort=c30", 2500);
      await scrollToEl(`document.querySelector('select[name=tag]')?.closest('section') ?? document.querySelector('table')`, 24);
      await shot("d04-rankings-filtered");
    }
    if (want("d05")) {
      await go(P + "/rankings", 2000);
      await scrollToEl("document.getElementById('add-keywords')", 24);
      await fill([
        ["#kw-list", "trail running shoes\nbest hiking backpack 2026\nhow to layer for winter hiking\nwaterproof hiking boots women"],
        ["#kw-tags", "product, footwear"],
        ["#kw-location", "Denver, Colorado"],
      ]);
      await sleep(300);
      await shot("d05-add-keywords");
    }
    if (want("d06")) {
      await go(P + "/rankings/" + KEYWORD + "?period=90", 2500);
      await shot("d06-keyword-detail");
      await scrollToEl(card("/^Latest results page$/"), 24);
      await shot("d06b-serp-snapshot");
      await tall("d06c-keyword-full", 4000);
    }
    if (want("d07")) {
      await go(P + "/rankings/competitors", 2500);
      await shot("d07-competitors");
    }
    if (want("d08")) {
      await go(P + "/audit", 2500);
      await shot("d08-audit");
      await tall("d08b-audit-full", 3200);
    }
    if (want("d09")) {
      const running = addRunningAudit();
      try {
        await go(P + "/audit", 1200);
        await shot("d09-audit-running");
      } finally {
        removeRunningAudit(running);
      }
    }
    if (want("d10")) {
      await go(P + "/audit/issues", 2000);
      await shot("d10-audit-issues");
      // Open the first two issues (help text, how to fix, affected pages).
      await evaluate(`(() => { const d = [...document.querySelectorAll('details')]; d.slice(0, 2).forEach((x) => x.open = true); return d.length; })()`);
      await sleep(500);
      await shot("d10b-issue-expanded");
      await go(P + "/audit/issues?change=new", 2000);
      await shot("d10c-issues-new");
    }
    if (want("d11")) {
      await go(P + "/audit/pages", 2000);
      await shot("d11-audit-pages");
      if (AUDIT_PAGE) {
        await go(P + "/audit/pages/" + AUDIT_PAGE, 2000);
        await shot("d11b-audit-page-detail");
        await tallTo("d11c-audit-page-full", card("/^Social tags$/"), 32);
      }
    }
    if (want("d12")) {
      await go(P + "/gsc", 2500);
      await shot("d12-gsc");
      await scrollToEl(card("/^Top queries and pages$/"), 24);
      await shot("d12b-gsc-queries");
      await clickText("button, [role=radio], label", /^Pages \(/);
      await sleep(700);
      await brandify();
      await shot("d12c-gsc-pages");
    }
    if (want("d13")) {
      await go(P + "/reports", 2000);
      await shot("d13-reports");
      await scrollToEl(card("/^Scheduled report emails$/"), 24);
      await shot("d13b-report-schedule");
      await scrollToEl("document.getElementById('badge')", 24);
      await shot("d13c-badge");
    }
    if (want("d14")) {
      await go(P + "/settings", 2000);
      await shot("d14-settings");
      for (const [name, re] of [
        ["d14b-settings-competitors", "/^Competitors$/"],
        ["d14c-settings-audit", "/^Site audit$/"],
        ["d14d-settings-alerts", "/^Alerts$/"],
        ["d14e-settings-branding", "/^Report branding$/"],
        ["d14f-settings-sharing", "/^Sharing$/"],
      ]) {
        await scrollToEl(card(re), 24);
        await shot(name);
      }
      await cardsShot("d14g-settings-competitors-checks-audit", "/^Competitors$/", "/^Site audit$/");
      await cardsShot("d14h-settings-alerts-branding-sharing", "/^Alerts$/", "/^Sharing$/");
    }
    if (want("d15")) {
      await go("/dashboard/channels", 2000);
      await shot("d15-alert-channels");
      await go("/dashboard/channels/new", 2000);
      await shot("d15b-alert-channel-new");
      await go("/dashboard/api-keys", 2000);
      await shot("d16-api-keys");
    }
  }

  // ── Mobile dashboard ──
  if (want("m2")) {
    await viewport(390, 844, PHONE);
    await go(P, 2500);
    await shot("m2-overview");
    await go(P + "/rankings", 2500);
    await shot("m3-rankings");
    await go(P + "/audit", 2500);
    await shot("m5-audit");
    await viewport(1440, 900);
  }

  // ── Arabic RTL and Hindi dashboard ──
  if (want("r")) {
    await lang("ar");
    await go(P, 2500);
    await shot("r1-overview-ar");
    await go(P + "/rankings", 2500);
    await shot("r2-rankings-ar");
    await lang("hi");
    await go(P, 2500);
    await shot("r3-overview-hi");
    await go(P + "/rankings", 2500);
    await shot("r4-rankings-hi");
    await go(P + "/audit", 2500);
    await shot("r5-audit-hi");
    await lang("en");
  }

  // ── Admin ──
  if (want("a")) {
    for (const [name, url] of [
      ["a1-admin-dashboard", "/admin"],
      ["a2-admin-users", "/admin/users"],
      ["a3-admin-plans", "/admin/plans"],
      ["a4-admin-rank-tracking", "/admin/settings/rank-tracking"],
      ["a5-admin-google", "/admin/settings/google"],
      ["a6-admin-seo-tools", "/admin/settings/tools"],
      ["a7-admin-languages", "/admin/languages"],
      ["a8-admin-system", "/admin/system"],
      ["a9-admin-payments", "/admin/payments"],
    ]) {
      if (!want(name)) continue;
      if (name === "a4-admin-rank-tracking") setProvider("serper");
      try {
        await go(url, 2000);
        if (name === "a1-admin-dashboard") await tall(name, 1700);
        else if (name === "a8-admin-system") await tall(name, 2400);
        else if (name === "a4-admin-rank-tracking") {
          await viewport(1440, 1300);
          await sleep(500);
          await brandify();
          await shot(name);
          await viewport(1440, 900);
          // API keys, check depth, checks per run and the Simulated provider switch.
          await scrollToEl(`[...document.querySelectorAll('h2,h3,h4,p,legend,div')].find((x) => x.children.length === 0 && x.textContent.trim() === 'API keys')`, 24);
          await shot("a4b-admin-rank-depth");
        }
        else await shot(name);
      } finally {
        if (name === "a4-admin-rank-tracking") setProvider("");
      }
    }
  }

  // ── Installer (a second server without APP_INSTALLED) ──
  if (want("i") && INSTALL_URL) {
    await go(INSTALL_URL + "/install", 2000);
    await shot("i1-installer");
    await clickText("button", /^Continue$/);
    await sleep(1500);
    await prep();
    await shot("i2-installer-database");
  }

  console.log("errors:", errors.length ? [...new Set(errors)].slice(0, 25) : "none");
} finally {
  await close();
  // Never leave the demo on Serper with the fake key.
  setProvider("");
  db.close();
}
process.exit(0);
