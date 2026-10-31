// Optional sample data for the marketing screenshots, written straight into a throw-away demo
// database (SQLite, node:sqlite). Run it once on a fresh DEMO_SEED database, then restart the
// server (the app keeps the site settings in memory).
//
//   node demo-extras.mjs [path/to/db.sqlite]
//
// Adds (all fake, for pictures only):
//   - Slack, Telegram, Discord, Teams (switched off) and webhook alert channels, Slack and
//     Telegram selected in Northwind's alerts, a few deliveries in the alert log;
//   - three API keys (random keys, only the hash is stored, as the app does);
//   - SMTP settings (so no "email isn't set up" notice) and a fake Google OAuth client;
//   - a Serper.dev API key that is NOT a real key. The active provider stays empty, so demo mode
//     keeps using the Simulated provider and no real SERP request is ever made. shoot.mjs selects
//     Serper only for the moment it captures Admin → Settings → Rank tracking, then clears it;
//   - a share link with a password ("client2026") on Acme Cloud, for the report password gate;
//   - the administrator renamed "Alex Morgan".
//
// DB: SZ_DB or the first argument (default /tmp/sz-mkt/storage/db.sqlite).
// Never run it against a database you care about: there is no restore.
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DB = process.argv[2] ?? process.env.SZ_DB ?? "/tmp/sz-mkt/storage/db.sqlite";
const db = new DatabaseSync(DB);
db.exec("PRAGMA busy_timeout = 10000");
const H = 3600_000, D = 24 * H;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

if (db.prepare("SELECT id FROM alert_channels WHERE name = ?").get("#seo-alerts")) {
  console.log("already applied");
  process.exit(0);
}

function insert(table, row) {
  const keys = Object.keys(row);
  const r = db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]));
  return Number(r.lastInsertRowid);
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
db.prepare("UPDATE users SET name = 'Alex Morgan' WHERE id = ?").run(admin.id);

// Alert channels (fake URLs and tokens).
const t0 = iso(70 * D);
const ch = (type, name, config, active = 1) => insert("alert_channels", { user_id: admin.id, type, name, config: JSON.stringify(config), is_active: active, created_at: t0, updated_at: t0 });
const slack = ch("slack", "#seo-alerts", { webhookUrl: "https://hooks.slack.com/services/T04NWX2KQ/B07PZ3M1L/k3nZ8qLm2YvW0aXcR5tP" });
const telegram = ch("telegram", "Agency team chat", { botToken: "7012345678:AAH3kz-PqLm8vXw2n5RtYc0bJ9dE4fGhUiK", chatId: "-1002345678901" });
ch("discord", "Content team", { webhookUrl: "https://discord.com/api/webhooks/1290455718/QmV2xLk9pR3tZ8wN" });
ch("teams", "Client success (Teams)", { webhookUrl: "https://prod-42.westeurope.logic.azure.com/workflows/8c1f0e2a/triggers/manual/paths/invoke" }, 0);
ch("webhook", "Zapier: rank changes", { url: "https://hooks.zapier.com/hooks/catch/1234567/abcde1/", secret: "whk_8fQ2mZ7xL4pR9tV3" });

const nw = db.prepare("SELECT id, settings FROM projects WHERE name = 'Northwind Outdoor'").get();
const settings = JSON.parse(nw.settings);
settings.alertChannelIds = [...new Set([...(settings.alertChannelIds ?? []), slack, telegram])];
db.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify(settings), nw.id);
for (const [channel, event, ago] of [[slack, "rank_entered_top:3", 5 * H], [telegram, "rank_entered_top:3", 5 * H], [slack, "rank_changed", 29 * H], [slack, "audit_finished", 3 * D]]) {
  insert("alert_log", { project_id: nw.id, channel_id: channel, event, ok: 1, error: null, created_at: iso(ago) });
}

// API keys.
for (const [name, used, created] of [["Client dashboard (Looker Studio)", 2 * H, 52 * D], ["Zapier: weekly sheet", 3 * D, 24 * D], ["Staging", null, 5 * D]]) {
  const key = "sz_" + crypto.randomBytes(30).toString("base64url").slice(0, 40);
  insert("api_keys", { user_id: admin.id, name, key_hash: crypto.createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 10), last_used_at: used ? iso(used) : null, created_at: iso(created) });
}

// SMTP and Google OAuth (fake values).
for (const [k, v] of Object.entries({
  mail_enabled: "1",
  smtp_host: "smtp.mailgun.org",
  smtp_port: "587",
  smtp_user: "postmaster@mg.example.com",
  smtp_pass: "demo-not-a-real-password",
  mail_from_name: "Searchzen",
  mail_from_address: "reports@example.com",
  google_client_id: "418275930164-q8v3k2m9tr5d1hc7n4lb0wx6ezs1yfpa.apps.googleusercontent.com",
  google_client_secret: "GOCSPX-demo-not-a-real-secret",
  // A Serper.dev key that is NOT real. serp_provider stays empty (Simulated in demo mode).
  serp_key_serper: "7f3c9a1e5b2d8f4a6c0e9b3d7a1f5c2e8b4d6a0f",
})) setSetting(k, v);

// A password-protected share link on Acme Cloud (password "client2026"), token as randomToken() makes it.
const shareToken = () => Array.from(crypto.randomBytes(24), (b) => "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 57]).join("");
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync("client2026", salt, 64, { N: 16384, r: 8, p: 1 });
const acme = db.prepare("SELECT id, settings FROM projects WHERE name = 'Acme Cloud'").get();
const acmeSettings = JSON.parse(acme.settings);
acmeSettings.sharePasswordHash = ["scrypt", 16384, 8, 1, salt.toString("base64"), hash.toString("base64")].join("$");
db.prepare("UPDATE projects SET settings = ?, share_token = ? WHERE id = ?").run(JSON.stringify(acmeSettings), shareToken(), acme.id);

console.log("demo extras applied to", DB);
