import type { SettingKey } from "@/lib/settings";

/**
 * Declarative description of every settings screen. The admin UI renders forms
 * from this list and the save action uses it to validate which keys a section
 * may change, so adding a setting only takes one entry here plus a default in
 * lib/settings.ts.
 */

export type FieldType = "text" | "textarea" | "code" | "switch" | "number" | "select" | "color" | "image" | "password" | "email" | "url";

export interface SettingField {
  key: SettingKey;
  label: string;
  type: FieldType;
  hint?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  /** Visually group fields under a sub-heading. */
  group?: string;
  /** Non-empty values must match this regular expression (checked when saving). */
  pattern?: string;
  patternError?: string;
}

export interface SettingSection {
  slug: string;
  title: string;
  description: string;
  fields: SettingField[];
}

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "SGD", "AED", "BRL", "JPY", "TRY", "IDR", "PKR", "BDT", "NGN", "ZAR", "MXN"];

export const SETTING_SECTIONS: SettingSection[] = [
  {
    slug: "general",
    title: "General",
    description: "Your site's name, address, logo and footer.",
    fields: [
      { key: "site_name", label: "Site name", type: "text" },
      { key: "site_tagline", label: "Tagline", type: "text" },
      { key: "site_url", label: "Site URL", type: "url", hint: "Full address without a trailing slash, e.g. https://seo.example.com" },
      { key: "site_email", label: "Contact email", type: "email", hint: "Shown on the contact page and receives contact-form messages." },
      { key: "logo", label: "Logo", type: "image", hint: "PNG, SVG or WebP, about 160 × 40 px. Leave empty to show the site name.", group: "Branding" },
      { key: "logo_dark", label: "Logo for dark mode", type: "image", hint: "Optional light-coloured version of your logo.", group: "Branding" },
      { key: "favicon", label: "Favicon", type: "image", hint: "Square PNG or ICO, at least 48 × 48 px.", group: "Branding" },
      { key: "footer_text", label: "Footer text", type: "textarea", group: "Footer" },
      { key: "copyright_text", label: "Copyright line", type: "text", hint: "{year} and {site_name} are replaced automatically.", group: "Footer" },
      { key: "blog_enabled", label: "Show the blog", type: "switch", hint: "Adds /blog, a Blog link in the header and footer, and the latest posts on the home page.", group: "Blog" },
    ],
  },
  {
    slug: "appearance",
    title: "Appearance",
    description: "Brand colour, theme and home page text.",
    fields: [
      { key: "primary_color", label: "Brand colour", type: "color", hint: "Used for buttons, links and highlights." },
      {
        key: "default_theme",
        label: "Default theme",
        type: "select",
        options: [
          { value: "system", label: "Follow the visitor's device" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
      { key: "home_hero_title", label: "Home page headline", type: "text", group: "Home page" },
      { key: "home_hero_subtitle", label: "Home page introduction", type: "textarea", group: "Home page" },
      { key: "show_stats_on_home", label: "Show the benefits strip under the hero", type: "switch", group: "Home page" },
    ],
  },
  {
    slug: "seo",
    title: "SEO",
    description: "Search engine titles, descriptions and verification.",
    fields: [
      { key: "meta_title", label: "Home page title", type: "text", hint: "50–60 characters works best." },
      { key: "meta_description", label: "Home page description", type: "textarea", hint: "120–160 characters works best." },
      { key: "meta_keywords", label: "Keywords", type: "text", hint: "Comma separated. Most search engines ignore this." },
      { key: "title_separator", label: "Title separator", type: "text", hint: "Placed between page and site name, e.g. \" | \" or \" – \"." },
      { key: "og_image", label: "Social sharing image", type: "image", hint: "1200 × 630 px. Shown when links are shared on social media." },
      { key: "google_site_verification", label: "Google Search Console code", type: "text", group: "Verification", placeholder: "Content value of the meta tag" },
      { key: "bing_site_verification", label: "Bing Webmaster code", type: "text", group: "Verification" },
      {
        key: "robots_extra",
        label: "Extra disallowed paths",
        type: "textarea",
        group: "Robots.txt",
        hint: "One rule per line, e.g. \"Disallow: /private\". Admin and account pages are always blocked.",
      },
    ],
  },
  {
    slug: "tools",
    title: "SEO tools",
    description: "Background jobs and the branding in shared reports and report emails.",
    fields: [
      {
        key: "lazy_scheduler",
        label: "Run background jobs on visits (no cron needed)",
        type: "switch",
        group: "Scheduler",
        hint: "Rank checks, audit crawling, Search Console imports and scheduled reports run in the background. When no cron job or worker has run them for a minute, the next visit runs them. Keep this on unless you set up the cron URL or the worker.",
      },
      { key: "branding_text", label: "Branding text", type: "text", group: "Branding", hint: "Shown at the bottom of shared reports and report emails, e.g. \"Powered by Searchzen\". Plans with \"Remove branding\" or white-label reports hide it." },
      { key: "branding_url", label: "Branding link", type: "url", group: "Branding", hint: "Where the branding link goes. Leave empty to use your site URL." },
      {
        key: "digest_enabled",
        label: "Send the weekly digest email",
        type: "switch",
        group: "Reports",
        hint: "Every Monday, project owners get an email with their keyword movers, site health and Search Console clicks. Users can turn it off on their dashboard. Needs email (SMTP) to be set up.",
      },
    ],
  },
  {
    // Custom screen (app/admin/settings/rank-tracking): SERP provider, API keys, depth, test and usage.
    slug: "rank-tracking",
    title: "Rank tracking",
    description: "SERP data provider, API keys, check depth and provider usage.",
    fields: [],
  },
  {
    slug: "google",
    title: "Google",
    description: "Google Search Console sign-in, so users can import clicks, impressions and queries.",
    fields: [
      {
        key: "google_client_id",
        label: "OAuth client ID",
        type: "text",
        placeholder: "1234567890-abc.apps.googleusercontent.com",
        hint: "Google Cloud console → APIs & Services: enable the \"Google Search Console API\", configure the OAuth consent screen (scope …/auth/webmasters.readonly) and create an OAuth client ID of type \"Web application\" with this authorized redirect URI: {site_url}/api/gsc/callback. Until Google verifies your app, it shows an \"unverified app\" warning and only the test users you add to the consent screen can connect. While the consent screen's publishing status is \"Testing\", Google expires refresh tokens after 7 days and users must reconnect: set it to \"In production\" for permanent connections.",
      },
      { key: "google_client_secret", label: "OAuth client secret", type: "password", placeholder: "GOCSPX-…" },
    ],
  },
  {
    slug: "payments",
    title: "Payments",
    description: "Accept payments for paid plans. Enable one or more gateways.",
    fields: [
      { key: "currency", label: "Currency", type: "select", options: CURRENCIES.map((c) => ({ value: c, label: c })), hint: "Must be supported by every gateway you enable." },
      { key: "stripe_enabled", label: "Enable Stripe (cards, Apple Pay, Google Pay)", type: "switch", group: "Stripe" },
      { key: "stripe_secret_key", label: "Secret key", type: "password", group: "Stripe", placeholder: "sk_live_…" },
      {
        key: "stripe_webhook_secret",
        label: "Webhook signing secret",
        type: "password",
        group: "Stripe",
        placeholder: "whsec_…",
        hint: "Create a webhook for {site_url}/api/payments/stripe/webhook with events invoice.paid, checkout.session.completed and customer.subscription.deleted.",
      },
      { key: "paypal_enabled", label: "Enable PayPal", type: "switch", group: "PayPal" },
      {
        key: "paypal_mode",
        label: "Mode",
        type: "select",
        group: "PayPal",
        options: [
          { value: "sandbox", label: "Sandbox (testing)" },
          { value: "live", label: "Live" },
        ],
      },
      { key: "paypal_client_id", label: "Client ID", type: "text", group: "PayPal" },
      { key: "paypal_secret", label: "Secret", type: "password", group: "PayPal" },
      { key: "razorpay_enabled", label: "Enable Razorpay", type: "switch", group: "Razorpay" },
      { key: "razorpay_key_id", label: "Key ID", type: "text", group: "Razorpay", placeholder: "rzp_live_…" },
      { key: "razorpay_key_secret", label: "Key secret", type: "password", group: "Razorpay" },
      { key: "offline_enabled", label: "Enable bank transfer", type: "switch", group: "Bank transfer", hint: "You approve each transfer manually in Admin → Payments." },
      { key: "offline_instructions", label: "Payment instructions", type: "textarea", group: "Bank transfer" },
    ],
  },
  {
    slug: "email",
    title: "Email",
    description: "SMTP server used for email alerts, scheduled client reports, password resets and contact-form notifications.",
    fields: [
      { key: "mail_enabled", label: "Send emails", type: "switch" },
      { key: "smtp_host", label: "SMTP host", type: "text", placeholder: "smtp.example.com" },
      { key: "smtp_port", label: "SMTP port", type: "number", hint: "Usually 587 (STARTTLS) or 465 (SSL)." },
      { key: "smtp_secure", label: "Use SSL (port 465)", type: "switch" },
      { key: "smtp_user", label: "Username", type: "text" },
      { key: "smtp_pass", label: "Password", type: "password" },
      { key: "mail_from_name", label: "Sender name", type: "text" },
      { key: "mail_from_address", label: "Sender email", type: "email" },
    ],
  },
  {
    slug: "users",
    title: "Users",
    description: "Registration and access rules.",
    fields: [
      { key: "registration_enabled", label: "Allow new registrations", type: "switch" },
      { key: "contact_enabled", label: "Show the contact page", type: "switch" },
      { key: "cookie_consent_enabled", label: "Show the cookie notice", type: "switch", group: "Cookie notice" },
      { key: "cookie_consent_text", label: "Cookie notice text", type: "textarea", group: "Cookie notice" },
    ],
  },
  {
    slug: "advanced",
    title: "Advanced",
    description: "Maintenance mode and custom code.",
    fields: [
      { key: "maintenance_mode", label: "Maintenance mode", type: "switch", hint: "Only administrators can see the site while this is on." },
      { key: "maintenance_message", label: "Maintenance message", type: "textarea" },
      { key: "custom_head_code", label: "Extra code in <head>", type: "code", group: "Custom code", hint: "Added to the <head> of every public page, e.g. a verification meta tag or a font." },
      { key: "custom_body_code", label: "Additional code", type: "code", group: "Custom code", hint: "E.g. a live chat widget." },
    ],
  },
];

export function getSection(slug: string): SettingSection | undefined {
  return SETTING_SECTIONS.find((s) => s.slug === slug);
}
