# Searchzen

SEO rank tracker and site audit SaaS, built with **Next.js 16**, **React 19** and **Tailwind CSS 4**.
Customers add their websites as projects, track keyword positions on Google by country, city,
language and device (through a SERP data provider: Serper.dev, SerpApi, DataForSEO or ValueSERP;
Searchzen never scrapes Google itself), crawl their sites for technical SEO issues (57 checks and a
health score), connect Google Search Console and share white-label reports with clients. Includes
alert channels (email, signed webhook, Slack, Discord, Microsoft Teams, Telegram), a weekly digest,
an embeddable SEO health badge, a REST API, paid plans with limits, four payment gateways, a blog,
multi-language/RTL and a full admin panel.

The complete guide is in [`documentation/index.html`](../documentation/index.html) (open it in a browser).

## Quick start (local)

```bash
npm install
npm run dev
```

Open http://localhost:3000. You are redirected to the web installer at `/install`.
Choose **SQLite** for a zero-setup local database (Node.js 22.13+), or **MySQL** for production.
`npm run dev` also builds the SEO health badge script `public/sz-badge.js` first (`predev`).

No keyword is checked until a SERP provider is chosen in **Admin → Settings → Rank tracking**.
To try the dashboard without an API key, switch on "Allow the Simulated provider" there and choose
**Simulated** (fake positions, testing only). The audit crawler refuses private and local addresses,
so audit a public website.

Background jobs run in "lazy mode" by default (after page views, at most once a minute). To run
them without that activity, start the worker in a second terminal with the secret from
Admin → System → Scheduler:

```bash
CRON_SECRET=the-secret-from-admin npm run worker
```

## Production

```bash
npm install
npm run build        # builds public/sz-badge.js (prebuild), then the Next.js app
npm start            # or: node server.js  (cPanel / Passenger / PM2)
```

Requirements: Node.js 20.9+ (22.13+ for the SQLite option), MySQL 5.7+/MariaDB 10.3+ (recommended)
or the built-in SQLite option, HTTPS (Google sign-in redirect, badge on customers' HTTPS sites),
outbound HTTPS (SERP provider, Google APIs, the audited websites on ports 80/443/8080/8443, alert
channels) and SMTP for emails.

### Secrets

| Variable | Why |
| -------- | --- |
| `CRON_SECRET` | Protects the cron URL `/api/cron/tick` and is used by the worker. **12+ random characters** (e.g. `openssl rand -hex 24`); shorter values and the example `change-me-to-a-long-random-string` are ignored (the app then uses a secret stored in the database, so the worker gets `401`). Without it, a secret is generated and shown in Admin → System → Scheduler. |
| `APP_SECRET` | 16+ characters. Encrypts Google Search Console refresh tokens (AES-256-GCM) and signs the OAuth state and report-password cookies. Without it, one is generated in `storage/config.json` (or a `settings` row on read-only disks). **Set it on Vercel and whenever several servers/containers run the app**, and never change it afterwards: stored Google tokens can't be decrypted with another secret (users must reconnect). |

### Background jobs and the worker

Every "tick" (`src/lib/scheduler.ts`) runs the jobs of `src/lib/jobs/index.ts` in order, within a
time budget (cron URL 45 s, lazy 8 s, "Run jobs now" 25 s), with a lock so ticks never overlap:

| Job | What it does |
| --- | --- |
| `rank-checks` | Due keywords with the active SERP provider: up to "Checks per run" (40), "Parallel requests" (3), within "Time per run" (20 s). Config errors pause all checks 30 min, quota errors 1 h. Every tick. |
| `audits` | Starts scheduled audits (checked every 15 min), then crawls/analyses running audits (max 20 s per audit per tick, resumable, 90 s lease per audit). Every tick. |
| `gsc-import` | Search Console: 90-day backfill in 10-day windows, then the last 3 days daily; prunes rows older than 490 days. Every tick while backfilling, else every 10 min. |
| `reports` | Scheduled report emails (weekly Mondays / monthly 1st, 07:00 UTC). Every 5 min. |
| `digest` | Weekly digest from Monday 07:00 UTC, once per account and week. Every 30 min. |
| `housekeeping` | Expired sessions and reset links, alert log > 90 days, SERP snapshots > 30 days. Hourly. |

Something must start ticks:

| Method | How | Notes |
| ------ | --- | ----- |
| Lazy mode | On by default (Admin → Settings → SEO tools) | Only while there is activity. Fine for testing. |
| Cron URL | `curl -fsS -m 70 "https://your-site/api/cron/tick?key=SECRET"` every minute | cPanel, shared hosting, Vercel (external cron service; Vercel Hobby cron runs only daily). Also accepts `Authorization: Bearer SECRET` (as sent by Vercel Cron). |
| Worker | `CRON_SECRET=… npm run worker` (calls the cron URL every 15 s) | VPS / Docker. `WORKER_URL` (default `SITE_URL`, else `http://localhost:$PORT`), `WORKER_INTERVAL_SEC` (default 15, min 5). |

- **PM2:** `ecosystem.config.cjs` starts the app (`searchzen`) and the worker (`searchzen-worker`).
  Export `CRON_SECRET` before `pm2 start ecosystem.config.cjs` (both processes read it).
- **Docker:** `docker-compose.yml` runs `app`, `worker` and MySQL 8.4; it refuses to start without
  `CRON_SECRET` in a `.env` file next to it.

Without ticks, keywords stay "Pending", audits stay queued (an open audit page drives its own audit
forward), Search Console data isn't imported and no report emails or digests are sent.

## Project structure

```
src/
  seo/                     The contract, dependency-free (server, client and badge):
    types.ts               Project settings, keyword input, devices, SERP features, depths, RankResult,
                           SerpProvider / SerpProviderError, audit checks / severities / summaries,
                           alert rules, channels and AlertPayload, REST API shapes
    normalize.ts           Validation (domains, keywords, tags, countries, languages, settings),
                           positionChange(), expectedCtr() / visibilityScore(), healthScore(),
                           effectiveFrequency(), effectivePageLimit(), nextCheckAt(), retryDelayMs()
    format.ts              Display helpers (positions, changes, limits, country / language options)
  badge/index.ts           SEO health badge (bundled to public/sz-badge.js, 2 KB gzip budget)
  lib/serp/                SERP providers
    index.ts               Registry (PROVIDERS), "Rank tracking" settings (serp_* rows + env keys),
                           active provider, global pause, provider_usage
    parse.ts               RankProvider / ProviderResult, ResultCollector (paging, own + competitor
                           positions), pagesFor(), httpError() → SerpProviderError kinds
    http.ts                serpFetch: SSRF-guarded undici fetch with timeout and 6 MB cap
    providers/             serper.ts, serpapi.ts, dataforseo.ts, valueserp.ts, simulated.ts
  lib/rank/                Rank tracking
    check.ts               The check engine (jobs, "Check now", API): plan gate, claims, saveCheck()
                           (one rankings row per keyword + UTC day, snapshots), alerts, pauses
    transitions.ts         Alert rules (enters/leaves top N, change ≥ N, target URL lost), once per day
    queries.ts             History, KPIs, visibility series, competitors / share of voice, snapshots
    service.ts             checkKeywordsNow() (100 per call, 10-min cooldown), history, summaries
    csv.ts                 CSV import (header aliases, ; or , separator) and export
  lib/audit/               Site audit
    crawler.ts             Resumable crawl in ticks: leases, init (robots, sitemaps, HTTPS, favicon),
                           frontier in audit_queue, external-link sample (50), 24 h limit
    fetch.ts               HTTP client: SearchzenBot UA, manual redirects, 3 MB cap, SSRF rules,
                           ALLOW_PRIVATE_CRAWL (tests only)
    robots.ts, sitemap.ts  robots.txt (RFC 9309 matching, Crawl-delay) and sitemap reader
    parse.ts               Dependency-free HTML extractor (no DOM, no parser library)
    checks/                The 57 checks (indexability, content, links, technical/performance/social)
    analyze.ts             Inlinks, click depth, issues, healthScore(), diff with the previous audit,
                           audit alerts, retention (last 10 finished audits keep pages and issues)
    service.ts, store.ts   Start / cancel / status, issue and page lists, CSV exports
  lib/gsc/                 Google Search Console
    google.ts              OAuth + Search Console API client (no SDK); GOOGLE_OAUTH_BASE /
                           GSC_API_BASE point it at a mock server in tests only
    oauth.ts               Signed, cookie-bound OAuth state (15 min)
    connections.ts         Encrypted refresh tokens, revocation, "revoked" handling + owner email
    import.ts, data.ts     Backfill / daily import into gsc_daily, reads for the dashboard
    properties.ts          Property matching and assignment
  lib/reports/             Report data and branding, share-link unlock cookies, schedules, report
                           and digest emails, digest opt-out, badge (score + SVG)
  lib/jobs/                Background jobs (see above); lib/scheduler.ts runs them, lib/lazy-tick.ts
  lib/crypto.ts            App secret, AES-256-GCM encryption, HMAC signatures
  lib/alerts/              Alert channels (email, webhook, slack, discord, teams, telegram)
  lib/net/ssrf.ts          Private-address rules for every outgoing request
  lib/projects.ts, keywords.ts, plans.ts, usage.ts   Projects, keywords, plan entitlements, quotas
  lib/api-v1.ts, api-keys.ts, api-guard.ts, api-audits.ts   REST API helpers, keys, auth + rate limit
  lib/i18n/messages.ts     Every interface string in English (source for translations)
  lib/db/migrations.ts     Database schema, indexes and default plans (run automatically)
  app/(site)/              Public website: home, pricing, blog, pages, account, auth, checkout
  app/(dashboard)/         Customer dashboard: projects (overview, rankings, site audit, Search
                           Console, reports, settings), alert channels, API keys
  app/r/[token]/           Shared client report (optional password, print to PDF)
  app/admin/               Admin panel (incl. Settings → Rank tracking and System → Scheduler)
  app/install/             Web installer
  app/actions/             Server actions (auth, billing, dashboard/*)
  app/api/v1/              REST API: projects, keywords (+ history, check), audits (+ issues)
  app/api/badge/[token]/   Badge data (JSON) and SVG image
  app/api/gsc/             connect (start OAuth) and callback ({SITE_URL}/api/gsc/callback)
  app/api/cron/tick/       Cron URL: runs one scheduler tick (secret required)
  app/api/payments/        Payment gateway callbacks for the platform's own plans
scripts/build-widget.mjs   Bundles src/badge into public/sz-badge.js with esbuild (2 KB gzip budget)
scripts/worker.mjs         Worker: calls /api/cron/tick every WORKER_INTERVAL_SEC (15 s)
languages/                 Arabic and Hindi language packs (import in Admin → Languages)
storage/                   Created at runtime: config.json (+ appSecret), SQLite database, uploads
```

`public/sz-badge.js` is generated and not committed. It is rebuilt by `predev`, `prebuild` and
`npm run widget:build`.

## REST API

`/api/v1`, `Authorization: Bearer sz_…` (keys in Dashboard → API keys; plans with API access).
`GET /projects`, `GET /projects/{id}`, `GET|POST /keywords`, `GET /keywords/{id}/history`,
`POST /keywords/check`, `POST /audits`, `GET /audits/{id}`, `GET /audits/{id}/issues`.
Errors are `{ "error": "…" }` with 401/403/404/409/413/422/429. 600 requests/min per key. See the
documentation for request and response examples.

## Scripts

| Command                | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `npm run dev`          | Build `sz-badge.js`, then start the development server        |
| `npm run build`        | Build `sz-badge.js`, then the production app                  |
| `npm start`            | Start the production server                                   |
| `npm run start:server` | Start via `server.js` (hosting panels, PM2)                   |
| `npm run worker`       | Run a scheduler tick every 15 s (needs `CRON_SECRET`)         |
| `npm run widget:build` | Rebuild only `public/sz-badge.js` (prints raw and gzip size)  |
| `npm run lint`         | ESLint                                                        |
| `npm run typecheck`    | TypeScript check                                              |

## Extending

- **SERP provider:** a `providers/<id>.ts` exporting `create…Provider({ apiKey, fetch, timeoutMs })`
  that returns a `RankProvider` (page through results with `pagesFor()` and a `ResultCollector`,
  map errors with `httpError()` / `SerpProviderError`); then add the id to `REAL_PROVIDER_IDS`,
  an entry to `PROVIDERS`, a case in `envKey()` (`<ID>_API_KEY`) and in `createProvider()` in
  `src/lib/serp/index.ts`. Ids are stored in `rankings.provider` (max 20 characters).
- **Audit check:** `pageCheck()` / `siteCheck()` in `src/lib/audit/checks/*.ts` plus the messages
  `audit.issue.<code>`, `.help` and `.fix`. New page data: `src/lib/audit/parse.ts` and `CrawledPage`.
- **Alert channel:** `CHANNEL_TYPES`/`ChannelConfigByType` in `src/seo/types.ts`,
  `normalizeChannelConfig`/`channelProblem` in `src/seo/normalize.ts`, a sender in
  `src/lib/alerts/` using `describeAlert()` and `deliver()`, a case in `sendAlert()`, the form in
  `src/components/dashboard/channel-forms.tsx` and `dash.channels.*` messages.
- **Background job:** implement `Job` (`src/lib/jobs/index.ts`), throttle it with
  `isDue()`/`scheduleNext()` from `jobs/shared.ts`, and add it to `JOBS`.

Run `npm run typecheck && npm run build` and restart the app and the worker after changes.

## Environment variables

Optional; the web installer writes `storage/config.json`. `.env.example` lists every variable the
code reads: database (`DATABASE_URL` or `DB_*`), `APP_INSTALLED`, `ADMIN_*`, `SITE_URL`,
`STORAGE_DIR`, `PORT`/`HOST`, `TRUSTED_PROXY_HOPS`, `CRON_SECRET`, `APP_SECRET`, `WORKER_URL`,
`WORKER_INTERVAL_SEC`, the SERP keys (`SERPER_API_KEY`, `SERPAPI_API_KEY`, `DATAFORSEO_LOGIN` +
`DATAFORSEO_PASSWORD`, `VALUESERP_API_KEY`, `SERP_PROVIDER`), `DEMO_MODE`, `DEMO_SEED`,
`ALLOW_PRIVATE_WEBHOOKS` and `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.

Testing only, never in production: `ALLOW_PRIVATE_CRAWL` (crawler may fetch private addresses),
`GOOGLE_OAUTH_BASE` and `GSC_API_BASE` (Google endpoints of a mock server), `NEXT_DIST_DIR`.
