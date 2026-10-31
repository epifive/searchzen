import "server-only";
import { sql, type Kysely } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";
import { DEFAULT_PAGES } from "./seed-pages";
import { DEFAULT_POSTS } from "./seed-posts";

/**
 * Versioned schema migrations. They run automatically on first database
 * access after an update, so buyers only need to replace files and restart.
 * Never edit a released migration: add a new one instead.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any>;

const ts = () => new Date().toISOString();

const migrations: Record<string, Migration> = {
  "2026_10_19_000001_initial_schema": {
    async up(db: AnyDb) {
      await db.schema
        .createTable("settings")
        .addColumn("key", "varchar(100)", (c) => c.primaryKey())
        .addColumn("value", "text")
        .execute();

      await db.schema
        .createTable("users")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("email", "varchar(190)", (c) => c.notNull().unique())
        .addColumn("password_hash", "varchar(255)", (c) => c.notNull())
        .addColumn("role", "varchar(20)", (c) => c.notNull().defaultTo("user"))
        .addColumn("status", "varchar(20)", (c) => c.notNull().defaultTo("active"))
        .addColumn("plan_id", "integer")
        .addColumn("plan_expires_at", "varchar(32)")
        .addColumn("stripe_customer_id", "varchar(100)")
        .addColumn("stripe_subscription_id", "varchar(100)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("sessions")
        .addColumn("id", "varchar(64)", (c) => c.primaryKey())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)", (c) => c.notNull())
        .addColumn("ip", "varchar(64)")
        .addColumn("user_agent", "varchar(255)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("sessions_user_id_idx").on("sessions").column("user_id").execute();

      await db.schema
        .createTable("password_resets")
        .addColumn("token_hash", "varchar(64)", (c) => c.primaryKey())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)", (c) => c.notNull())
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("plans")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("name", "varchar(100)", (c) => c.notNull())
        .addColumn("description", "varchar(255)")
        .addColumn("price_monthly", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("price_yearly", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("features", "text")
        // 0 means unlimited for the max_* limits below.
        .addColumn("max_projects", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("max_keywords", "integer", (c) => c.notNull().defaultTo(10))
        .addColumn("check_frequency", "varchar(10)", (c) => c.notNull().defaultTo("weekly"))
        .addColumn("max_audit_pages", "integer", (c) => c.notNull().defaultTo(100))
        .addColumn("max_audits_monthly", "integer", (c) => c.notNull().defaultTo(2))
        .addColumn("allow_gsc", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("allow_white_label", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("allow_api", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("remove_branding", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("is_free", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("is_featured", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("payments")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("plan_id", "integer", (c) => c.notNull())
        .addColumn("amount", "integer", (c) => c.notNull())
        .addColumn("currency", "varchar(10)", (c) => c.notNull())
        .addColumn("billing_cycle", "varchar(10)", (c) => c.notNull())
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("provider_ref", "varchar(190)", (c) => c.notNull().unique())
        .addColumn("status", "varchar(20)", (c) => c.notNull())
        .addColumn("note", "text")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("payments_user_id_idx").on("payments").column("user_id").execute();

      await db.schema
        .createTable("pages")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("slug", "varchar(120)", (c) => c.notNull().unique())
        .addColumn("title", "varchar(255)", (c) => c.notNull())
        .addColumn("content", "text", (c) => c.notNull())
        .addColumn("meta_description", "varchar(255)")
        .addColumn("is_published", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("show_in_footer", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("contact_messages")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("email", "varchar(190)", (c) => c.notNull())
        .addColumn("subject", "varchar(255)", (c) => c.notNull())
        .addColumn("message", "text", (c) => c.notNull())
        .addColumn("ip", "varchar(64)")
        .addColumn("is_read", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("languages")
        .addColumn("code", "varchar(12)", (c) => c.primaryKey())
        .addColumn("name", "varchar(60)", (c) => c.notNull())
        .addColumn("native_name", "varchar(60)", (c) => c.notNull())
        .addColumn("direction", "varchar(3)", (c) => c.notNull().defaultTo("ltr"))
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
        .execute();

      await db.schema
        .createTable("translations")
        .addColumn("lang", "varchar(12)", (c) => c.notNull())
        .addColumn("key", "varchar(190)", (c) => c.notNull())
        .addColumn("value", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("translations_pk", ["lang", "key"])
        .execute();

      await db.schema
        .createTable("posts")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("slug", "varchar(160)", (c) => c.notNull().unique())
        .addColumn("title", "varchar(255)", (c) => c.notNull())
        .addColumn("excerpt", "varchar(500)")
        .addColumn("content", "text", (c) => c.notNull())
        .addColumn("cover_image", "varchar(500)")
        .addColumn("meta_description", "varchar(255)")
        .addColumn("status", "varchar(12)", (c) => c.notNull().defaultTo("draft"))
        .addColumn("published_at", "varchar(32)")
        .addColumn("views", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("posts_status_published_idx").on("posts").columns(["status", "published_at"]).execute();

      // ── SEO projects and rank tracking ──
      await db.schema
        .createTable("projects")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("domain", "varchar(255)", (c) => c.notNull())
        .addColumn("settings", "text", (c) => c.notNull())
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("active"))
        .addColumn("share_token", "varchar(48)", (c) => c.unique())
        .addColumn("gsc_property", "varchar(255)")
        .addColumn("gsc_connection_id", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("projects_user_idx").on("projects").column("user_id").execute();

      await db.schema
        .createTable("keywords")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("project_id", "integer", (c) => c.notNull())
        .addColumn("phrase", "varchar(255)", (c) => c.notNull())
        .addColumn("country", "varchar(2)", (c) => c.notNull())
        .addColumn("language", "varchar(10)", (c) => c.notNull())
        .addColumn("device", "varchar(10)", (c) => c.notNull().defaultTo("desktop"))
        .addColumn("location", "varchar(255)", (c) => c.notNull().defaultTo(""))
        .addColumn("dedupe_key", "varchar(64)", (c) => c.notNull())
        .addColumn("tags", "text", (c) => c.notNull())
        .addColumn("target_url", "varchar(1000)")
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("active"))
        .addColumn("last_checked_at", "varchar(32)")
        .addColumn("last_position", "integer")
        .addColumn("best_position", "integer")
        .addColumn("start_position", "integer")
        .addColumn("last_url", "varchar(1000)")
        .addColumn("last_features", "text", (c) => c.notNull())
        .addColumn("next_check_at", "varchar(32)", (c) => c.notNull())
        .addColumn("fail_count", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("last_error", "varchar(500)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("keywords_project_dedupe_uq", ["project_id", "dedupe_key"])
        .execute();
      // Due keywords: WHERE status = 'active' AND next_check_at <= now ORDER BY next_check_at.
      await db.schema.createIndex("keywords_due_idx").on("keywords").columns(["status", "next_check_at"]).execute();
      await db.schema.createIndex("keywords_project_status_idx").on("keywords").columns(["project_id", "status"]).execute();

      await db.schema
        .createTable("rankings")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("keyword_id", "integer", (c) => c.notNull())
        .addColumn("project_id", "integer", (c) => c.notNull())
        .addColumn("day", "varchar(10)", (c) => c.notNull())
        .addColumn("position", "integer")
        .addColumn("url", "varchar(1000)")
        .addColumn("features", "text", (c) => c.notNull())
        .addColumn("competitors", "text", (c) => c.notNull())
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("checked_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("rankings_keyword_day_uq", ["keyword_id", "day"])
        .execute();
      await db.schema.createIndex("rankings_project_day_idx").on("rankings").columns(["project_id", "day"]).execute();

      await db.schema
        .createTable("serp_snapshots")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("keyword_id", "integer", (c) => c.notNull())
        .addColumn("checked_at", "varchar(32)", (c) => c.notNull())
        .addColumn("results", "text", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("serp_snapshots_keyword_idx").on("serp_snapshots").columns(["keyword_id", "checked_at"]).execute();
      await db.schema.createIndex("serp_snapshots_checked_idx").on("serp_snapshots").column("checked_at").execute();

      // ── Site audits ──
      await db.schema
        .createTable("audits")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("project_id", "integer", (c) => c.notNull())
        .addColumn("status", "varchar(12)", (c) => c.notNull().defaultTo("queued"))
        .addColumn("triggered_by", "varchar(10)", (c) => c.notNull().defaultTo("manual"))
        .addColumn("settings", "text", (c) => c.notNull())
        .addColumn("started_at", "varchar(32)")
        .addColumn("finished_at", "varchar(32)")
        .addColumn("pages_crawled", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("pages_limit", "integer", (c) => c.notNull())
        .addColumn("score", "integer")
        .addColumn("issues_summary", "text", (c) => c.notNull())
        .addColumn("error", "varchar(500)")
        .addColumn("locked_until", "varchar(32)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("audits_project_created_idx").on("audits").columns(["project_id", "created_at"]).execute();
      await db.schema.createIndex("audits_status_idx").on("audits").column("status").execute();

      await db.schema
        .createTable("audit_pages")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("audit_id", "integer", (c) => c.notNull())
        .addColumn("url", "varchar(1000)", (c) => c.notNull())
        .addColumn("url_hash", "varchar(64)", (c) => c.notNull())
        .addColumn("status_code", "integer")
        .addColumn("redirect_to", "varchar(1000)")
        .addColumn("depth", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("content_type", "varchar(100)")
        .addColumn("size_bytes", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("load_ms", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("title", "text")
        .addColumn("meta_description", "text")
        .addColumn("h1_count", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("canonical", "varchar(1000)")
        .addColumn("robots_meta", "varchar(255)")
        .addColumn("word_count", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("internal_links", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("external_links", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("inlinks", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("data", "text", (c) => c.notNull())
        .addColumn("issues", "text", (c) => c.notNull())
        .addColumn("fetched_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("audit_pages_audit_url_uq", ["audit_id", "url_hash"])
        .execute();
      await db.schema.createIndex("audit_pages_audit_status_idx").on("audit_pages").columns(["audit_id", "status_code"]).execute();

      await db.schema
        .createTable("audit_queue")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("audit_id", "integer", (c) => c.notNull())
        .addColumn("url", "varchar(1000)", (c) => c.notNull())
        .addColumn("url_hash", "varchar(64)", (c) => c.notNull())
        .addColumn("depth", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("found_on", "varchar(1000)")
        .addColumn("state", "varchar(10)", (c) => c.notNull().defaultTo("pending"))
        .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("audit_queue_audit_url_uq", ["audit_id", "url_hash"])
        .execute();
      // Next URLs to crawl: WHERE audit_id = ? AND state = 'pending' ORDER BY id.
      await db.schema.createIndex("audit_queue_audit_state_idx").on("audit_queue").columns(["audit_id", "state", "id"]).execute();

      await db.schema
        .createTable("audit_issues")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("audit_id", "integer", (c) => c.notNull())
        .addColumn("page_id", "integer")
        .addColumn("code", "varchar(60)", (c) => c.notNull())
        .addColumn("severity", "varchar(10)", (c) => c.notNull())
        .addColumn("details", "text", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("audit_issues_audit_code_idx").on("audit_issues").columns(["audit_id", "code"]).execute();
      await db.schema.createIndex("audit_issues_audit_severity_idx").on("audit_issues").columns(["audit_id", "severity"]).execute();
      await db.schema.createIndex("audit_issues_page_idx").on("audit_issues").column("page_id").execute();

      // ── Google Search Console ──
      await db.schema
        .createTable("gsc_connections")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("google_email", "varchar(190)", (c) => c.notNull())
        .addColumn("refresh_token", "text", (c) => c.notNull())
        .addColumn("scopes", "varchar(500)", (c) => c.notNull().defaultTo(""))
        .addColumn("last_error", "varchar(500)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("gsc_connections_user_email_uq", ["user_id", "google_email"])
        .execute();

      await db.schema
        .createTable("gsc_daily")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("project_id", "integer", (c) => c.notNull())
        .addColumn("day", "varchar(10)", (c) => c.notNull())
        .addColumn("query", "varchar(500)", (c) => c.notNull().defaultTo(""))
        .addColumn("page", "varchar(1000)", (c) => c.notNull().defaultTo(""))
        .addColumn("clicks", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("impressions", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("ctr", "double precision", (c) => c.notNull().defaultTo(0))
        .addColumn("position", "double precision", (c) => c.notNull().defaultTo(0))
        .execute();
      await db.schema.createIndex("gsc_daily_project_day_idx").on("gsc_daily").columns(["project_id", "day"]).execute();

      // ── Provider usage and reports ──
      await db.schema
        .createTable("provider_usage")
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("day", "varchar(10)", (c) => c.notNull())
        .addColumn("requests", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("errors", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("credits", "integer", (c) => c.notNull().defaultTo(0))
        .addPrimaryKeyConstraint("provider_usage_pk", ["provider", "day"])
        .execute();

      await db.schema
        .createTable("report_schedules")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("project_id", "integer", (c) => c.notNull())
        .addColumn("frequency", "varchar(10)", (c) => c.notNull().defaultTo("weekly"))
        .addColumn("recipients", "varchar(1000)", (c) => c.notNull())
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("last_sent_at", "varchar(32)")
        .addColumn("next_send_at", "varchar(32)", (c) => c.notNull())
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("report_schedules_project_idx").on("report_schedules").column("project_id").execute();
      await db.schema.createIndex("report_schedules_due_idx").on("report_schedules").columns(["is_active", "next_send_at"]).execute();

      await db.schema
        .createTable("api_keys")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("key_hash", "varchar(64)", (c) => c.notNull().unique())
        .addColumn("prefix", "varchar(12)", (c) => c.notNull())
        .addColumn("last_used_at", "varchar(32)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("api_keys_user_idx").on("api_keys").column("user_id").execute();

      await db.schema
        .createTable("usage_monthly")
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("month", "varchar(7)", (c) => c.notNull())
        .addColumn("serp_requests", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("audit_pages", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("audits", "integer", (c) => c.notNull().defaultTo(0))
        .addPrimaryKeyConstraint("usage_monthly_pk", ["user_id", "month"])
        .execute();

      await db.schema
        .createTable("alert_channels")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("type", "varchar(12)", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("config", "text", (c) => c.notNull())
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("alert_channels_user_idx").on("alert_channels").column("user_id").execute();

      await db.schema
        .createTable("alert_log")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("project_id", "integer")
        .addColumn("channel_id", "integer")
        .addColumn("event", "varchar(30)", (c) => c.notNull())
        .addColumn("ok", "integer", (c) => c.notNull())
        .addColumn("error", "varchar(500)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("alert_log_project_idx").on("alert_log").columns(["project_id", "created_at"]).execute();
    },
    async down(db: AnyDb) {
      for (const table of [
        "alert_log",
        "alert_channels",
        "usage_monthly",
        "api_keys",
        "report_schedules",
        "provider_usage",
        "gsc_daily",
        "gsc_connections",
        "audit_issues",
        "audit_queue",
        "audit_pages",
        "audits",
        "serp_snapshots",
        "rankings",
        "keywords",
        "projects",
        "posts",
        "translations",
        "languages",
        "contact_messages",
        "pages",
        "payments",
        "plans",
        "password_resets",
        "sessions",
        "users",
        "settings",
      ]) {
        await db.schema.dropTable(table).ifExists().execute();
      }
    },
  },

  "2026_10_19_000002_seed_defaults": {
    async up(db: AnyDb) {
      const now = ts();
      await db
        .insertInto("plans")
        .values([
          {
            name: "Free",
            description: "Track a website's rankings and health for free.",
            price_monthly: 0,
            price_yearly: 0,
            // Display text only (see Admin → Plans). Keep it in line with the limits below.
            features: ["1 project", "10 tracked keywords", "Weekly rank checks", "100 pages per site audit", "2 site audits per month", "Alerts by email, Slack and more"].join("\n"),
            max_projects: 1,
            max_keywords: 10,
            check_frequency: "weekly",
            max_audit_pages: 100,
            max_audits_monthly: 2,
            allow_gsc: 0,
            allow_white_label: 0,
            allow_api: 0,
            remove_branding: 0,
            is_free: 1,
            is_active: 1,
            is_featured: 0,
            sort_order: 1,
            created_at: now,
          },
          {
            name: "Pro",
            description: "Daily rankings and deeper audits for growing sites.",
            price_monthly: 1900,
            price_yearly: 19000,
            features: [
              "5 projects",
              "300 tracked keywords",
              "Daily rank checks",
              "1,000 pages per site audit",
              "20 site audits per month",
              "Google Search Console data",
              "REST API",
            ].join("\n"),
            max_projects: 5,
            max_keywords: 300,
            check_frequency: "daily",
            max_audit_pages: 1000,
            max_audits_monthly: 20,
            allow_gsc: 1,
            allow_white_label: 0,
            allow_api: 1,
            remove_branding: 0,
            is_free: 0,
            is_active: 1,
            is_featured: 1,
            sort_order: 2,
            created_at: now,
          },
          {
            name: "Agency",
            description: "For agencies and consultants with many client sites.",
            price_monthly: 4900,
            price_yearly: 49000,
            features: [
              "25 projects",
              "2,000 tracked keywords",
              "Daily rank checks",
              "5,000 pages per site audit",
              "100 site audits per month",
              "White-label client reports",
              "Everything in Pro",
            ].join("\n"),
            max_projects: 25,
            max_keywords: 2000,
            check_frequency: "daily",
            max_audit_pages: 5000,
            max_audits_monthly: 100,
            allow_gsc: 1,
            allow_white_label: 1,
            allow_api: 1,
            remove_branding: 1,
            is_free: 0,
            is_active: 1,
            is_featured: 0,
            sort_order: 3,
            created_at: now,
          },
        ])
        .execute();

      await db
        .insertInto("pages")
        .values(
          DEFAULT_PAGES.map((p) => ({
            slug: p.slug,
            title: p.title,
            content: p.content,
            meta_description: p.metaDescription,
            is_published: 1,
            show_in_footer: 1,
            created_at: now,
            updated_at: now,
          })),
        )
        .execute();

      await db.insertInto("languages").values({ code: "en", name: "English", native_name: "English", direction: "ltr", is_active: 1, sort_order: 0 }).execute();
      await db
        .insertInto("posts")
        .values(
          DEFAULT_POSTS.map((p, i) => ({
            slug: p.slug,
            title: p.title,
            excerpt: p.excerpt,
            content: p.content,
            cover_image: null,
            meta_description: p.metaDescription,
            status: "published",
            published_at: new Date(Date.now() - (DEFAULT_POSTS.length - i) * 86_400_000).toISOString(),
            views: 0,
            created_at: now,
            updated_at: now,
          })),
        )
        .execute();
    },
    async down(db: AnyDb) {
      for (const table of ["posts", "languages", "pages", "plans"]) await sql`DELETE FROM ${sql.table(table)}`.execute(db);
    },
  },

  // Rank alerts fired on a keyword's day (JSON rule keys), so a rule fires once per day at most.
  "2026_10_20_000010_rank_alerts": {
    async up(db: AnyDb) {
      await db.schema.alterTable("rankings").addColumn("alerts", "varchar(255)").execute();
    },
    async down(db: AnyDb) {
      await db.schema.alterTable("rankings").dropColumn("alerts").execute();
    },
  },

  // HTTP status of crawl-frontier rows (external link checks of the site audit).
  "2026_10_20_000020_audit_queue_status": {
    async up(db: AnyDb) {
      await db.schema.alterTable("audit_queue").addColumn("status_code", "integer").execute();
    },
    async down(db: AnyDb) {
      await db.schema.alterTable("audit_queue").dropColumn("status_code").execute();
    },
  },

  // Plan usage alerts (80 % / 100 % of the keyword limit or the monthly audits) sent this month.
  "2026_10_20_000040_usage_quota_alerts": {
    async up(db: AnyDb) {
      await db.schema.alterTable("usage_monthly").addColumn("quota_alerts", "varchar(255)").execute();
    },
    async down(db: AnyDb) {
      await db.schema.alterTable("usage_monthly").dropColumn("quota_alerts").execute();
    },
  },
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
