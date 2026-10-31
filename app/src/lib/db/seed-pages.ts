/**
 * Default content pages created on install. Buyers edit them from
 * Admin → Pages. `{site_name}` and `{site_email}` are replaced when rendered.
 * They are a starting point, not legal advice: buyers should adapt them to their
 * business and the laws that apply to them.
 */
export const DEFAULT_PAGES = [
  {
    slug: "about",
    title: "About Us",
    metaDescription: "{site_name} helps website owners, marketers and agencies track their Google rankings, audit their sites for technical SEO issues and report results to clients.",
    content: `## Who we are

{site_name} is an SEO platform for website owners, marketers and agencies. It answers three questions every week: where do our pages rank on Google, what is holding them back, and how do we show the progress to the people who pay for it?

## What {site_name} does

- **Rank tracking.** Daily or weekly Google positions for your keywords, on desktop and mobile, in 77 countries and down to a single city. We record the ranking page, SERP features such as AI overviews, featured snippets and local packs, and the competitors around you.
- **Site audit.** Our crawler, SearchzenBot, reads your site the way a search engine does and runs 57 checks for indexability, content, links, performance, social tags and technical setup. Every issue comes with an explanation, the affected pages and a health score you can track over time.
- **Search Console data.** Connect Google Search Console (read-only) to see real clicks, impressions and queries next to your rankings.
- **Client reports.** White-label reports with your logo and colours, shared as a live link (optionally with a password), emailed on a schedule or saved as a PDF.
- **Alerts and API.** Hear about important changes by email, Slack, Discord, Telegram, Microsoft Teams or webhook, and connect your own tools through the REST API.

## How we get our data

We never scrape Google. Rankings come from established SERP data providers through their official APIs, and traffic data comes from Google's own Search Console API with your permission. The site audit only visits public pages of the websites you add, and it follows their robots.txt rules.

## What we believe

- **You can't improve what you don't measure.** Consistent daily checks show what really changed, and when.
- **Technical SEO should be a to-do list, not a mystery.** Plain-language explanations beat jargon.
- **Clients deserve clear reports.** A report should answer "are we doing better?" in under a minute.
- **Your data belongs to you.** Export keywords, rankings and audit results to CSV whenever you like, or pull them through the API.

## Who uses {site_name}

Bloggers, online shops, SaaS companies, local businesses and SEO agencies managing dozens of client websites.

## Contact

Questions or ideas? [Get in touch](/contact) — we read every message.`,
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    metaDescription: "How {site_name} handles the data of its customers, the websites they track and audit, and Google Search Console data.",
    content: `## Overview

This policy explains what data {site_name} collects, why, who processes it on our behalf and what control you have over it. We collect only what is needed to run the service.

## Account data

When you create an account we store your name, email address and a securely hashed password, your language preference and your plan. Payments are handled by our payment provider; we receive the payment status and a reference, never your full card number.

## What you set up in {site_name}

We store the projects you create (website addresses and settings), tracked keywords with their country, language, device and location, tags, competitors, alert rules and alert channels (for example an email address, a Slack or Teams webhook address, or a Telegram bot token), report settings and branding, report schedules with their recipients' email addresses, and API keys (stored as a one-way hash; we can't read them back).

## Rank tracking

To check a keyword we send the keyword, with the country, language, device and location you chose, to the search data provider that this platform uses. We store the positions, the ranking URLs, the SERP features found and a snapshot of the top results. Ranking history is kept while the project exists; full search result snapshots are deleted after 30 days.

## Site audits and our crawler

When you run a site audit, our crawler visits the public pages of the website you entered. By default it identifies itself with the user agent **SearchzenBot/1.0** followed by a link to this website, obeys the site's robots.txt rules (including Crawl-delay) and limits its speed. It doesn't log in, submit forms, run JavaScript or crawl private network addresses.

For each page it stores technical facts: the URL, status code, redirects, title, meta description, headings, canonical and hreflang tags, structured data types, links, word count, image alt text, page size and response time. It doesn't collect personal data from the pages it visits. Audit results are kept while the project exists; older audits may be summarised to save space.

## Google Search Console

If you connect Google Search Console, we ask Google for read-only access (the webmasters.readonly scope) and store the refresh token encrypted. We import search performance data (queries, pages, countries, devices, clicks, impressions, click-through rate and position) for the properties you choose, and keep it for up to 16 months, as Google does. When you disconnect, we revoke the access at Google and delete the token; data already imported stays with the project until you delete it.

**Limited Use.** {site_name}'s use and transfer of information received from Google APIs to any other app adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. We use Google user data only to show it to you in {site_name} and in the reports you choose to share. We don't sell it, don't use it for advertising, don't use it to train AI models and don't let people read it, except with your permission, for security reasons, to comply with the law, or when it has been aggregated and anonymised for internal operations.

## Shared reports and the SEO health badge

If you create a report link, anyone with the link (and the password, if you set one) can see that project's report. You can add a password, replace the link or turn sharing off at any time. The SEO health badge shows only the latest health score of a project whose report is shared; it sets no cookies and collects no data about the visitors of the site where it is embedded.

## Cookies

We only use cookies that are needed for the service to work:

- **tz_session** keeps you signed in (up to 30 days).
- **tz_lang** remembers the language you chose (1 year).
- **sz_r_<token>** is set after you enter the password of a shared report. It is signed, only unlocks that one report and expires after 30 days.
- **sz_gsc_state** is a short-lived security value (protection against cross-site request forgery) while you connect Google Search Console. It is deleted when the connection is finished.

Your theme and cookie notice choices are saved in your browser's local storage. We don't use advertising or third-party tracking cookies, and the SEO health badge sets no cookies.

## Sub-processors

We don't sell data and don't share it with advertisers. We share only what is needed with the services that help us run {site_name}:

- **Hosting and database** providers that store the data.
- **Email delivery** for account emails, alerts and scheduled reports.
- **Payment** providers for paid plans.
- **Search data providers.** Rank checks are processed by the SERP data provider chosen by the operator of this platform (one of Serper, SerpApi, DataForSEO or ValueSERP). They receive the keyword and search settings, never your account details.
- **Google**, when you connect Search Console.
- **Alert channels you configure** (such as Slack, Discord, Microsoft Teams, Telegram or your own webhook) receive the alert messages you asked for.

## How long we keep data

Account data, projects, keywords, ranking history and audit results are kept while your account exists. SERP snapshots are deleted after 30 days, alert logs after 90 days and Search Console data after 16 months. When you delete a project or your account, its data is deleted too.

## Security

Passwords are hashed, connections are encrypted, Search Console tokens are stored encrypted, API keys are stored as hashes and access to our servers is restricted. No system is perfectly secure, but we work hard to protect your data.

## Your rights

You can see, export and change your details at any time from your account page, export your data to CSV, disconnect Google at any time and ask us to delete your account. Depending on where you live you may have further rights (for example under the GDPR); contact us to use them.

## Changes

We may update this policy. For important changes we will let customers know by email.

## Contact

For privacy questions contact us at {site_email}.`,
  },
  {
    slug: "terms-of-service",
    title: "Terms of Service",
    metaDescription: "The terms that apply when you use {site_name}.",
    content: `## Acceptance

By creating an account or using {site_name} you agree to these terms. If you use {site_name} for a company, you confirm that you may accept these terms on its behalf.

## Your account

Keep your login details and API keys safe. You are responsible for everything done with your account and for the people you share reports and API keys with.

## Acceptable use

- **Only audit websites that you own, or that you are authorised to audit** (for example by a client who hired you). Site owners can see our crawler, SearchzenBot, in their logs and may contact us.
- Don't use {site_name} to overload, attack or probe websites, to get around logins, paywalls or robots.txt rules, or to collect personal data.
- Don't try to break the plan limits, share accounts to avoid them, or automate the service beyond what the REST API offers.
- Don't resell raw search data or use the service for anything unlawful, deceptive or abusive, including spam sent through alert channels or scheduled reports.
- Share report links and badges only for data you are allowed to publish.

We may pause audits or rank checks, or suspend accounts, that break these rules or put the service or other websites at risk.

## Search data and accuracy

Rankings come from third-party search data providers and reflect the results at the moment of the check, for the location and device chosen. Search results are personalised and change during the day, so the positions you see in your own browser may differ. Search Console data is provided by Google and may be delayed by a few days. Site audits test common technical SEO rules; passing them does not guarantee any ranking.

## Google Search Console

When you connect Search Console you authorise us to read the data of the properties you choose, as described in our [Privacy Policy](/p/privacy-policy). You can disconnect at any time from your project settings or your Google account.

## Plans, limits and payments

Plan limits — projects, tracked keywords, check frequency, pages per audit and audits per month — are shown on the pricing page. When an account reaches a limit, new keywords or audits can't be added until you upgrade or the next month starts. Paid plans renew or expire according to the billing period you chose. You can change or cancel your plan at any time; already paid periods are not refunded unless the law requires it.

## Your content

You keep all rights to your data and reports. You give us permission to store and process it only to provide the service to you.

## Availability

We work hard to keep {site_name} available and accurate, but the service is provided "as is", without warranties of any kind. Checks may be delayed when a data provider is unavailable. Our liability is limited to the amount you paid us in the last 12 months.

## Changes

We may update these terms. We will let customers know about important changes; continued use after a change means you accept the new terms.

## Contact

Questions about these terms? Write to {site_email}.`,
  },
];
