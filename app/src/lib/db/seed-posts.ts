/** Starter blog posts created on install (Admin → Blog). Markdown. */
export const DEFAULT_POSTS = [
  {
    slug: "track-keyword-rankings-without-scraping-google",
    title: "How to track keyword rankings without scraping Google",
    excerpt: "Searching for your own keywords gives you a different answer every time, and scraping Google gets you blocked. Here is how professional rank tracking works, and how to read the numbers.",
    metaDescription: "Track Google keyword rankings the reliable way: SERP APIs instead of scraping, choosing keywords, country, city and device, check frequency, SERP features and visibility.",
    content: `## Why checking Google yourself doesn't work

Google personalises results by location, device, language and your own search history. The position you see in your browser is rarely the one your customers see, and it changes from one search to the next. A rank tracker checks every keyword the same way each time, from the location and device you choose, so a change in the numbers means something changed on Google.

## Why scraping Google is a dead end

The obvious shortcut is a script that loads Google's result pages and reads the positions. It breaks quickly:

- **Google's terms of service forbid automated queries**, and Google actively blocks them with CAPTCHAs and IP bans.
- **You end up managing proxies**, rotating user agents and fixing the parser every time the result page changes.
- **Your own server's IP can get flagged**, which can affect other things you run on it.

## The reliable way: SERP APIs

SERP data providers such as Serper, SerpApi, DataForSEO and ValueSERP run this infrastructure as their business. You send a keyword with a country, language, device and optional city; they return the full result page as structured data: organic positions, URLs, titles and the SERP features on the page.

What to look for in a provider:

- **Location targeting** down to the city, if you do local SEO.
- **Desktop and mobile** results.
- **Result depth**: the top 10 is cheaper, the top 100 shows keywords that are still climbing.
- **Price per search** at your volume. Costs differ a lot between providers and plans, and most give free credits to test.

Pair it with **Google Search Console**, which is free and official: it shows the clicks and impressions your pages actually received. Rankings tell you *where* you are; Search Console tells you *what it's worth*.

## Pick the right keywords

Start with 20 to 50 phrases that matter for the business:

- **Money keywords:** the products and services you sell ("trail running shoes", "dentist in leeds").
- **Problem keywords:** what people search before they know your product ("how to choose running shoes").
- **Brand keywords:** your name, so you notice when someone else outranks you for it.

Tag them (*product*, *blog*, *local*) so you can see which part of the site is moving, and add a target URL so you notice when Google ranks the wrong page.

## Choose country, city and device

If you sell nationally, track the country. If you serve a city, track that city: local results, with their map pack, differ a lot from national ones. Track mobile as well as desktop for important keywords, because Google ranks the two separately.

## How often to check

Daily checks catch problems within a day and show the effect of a change quickly; weekly checks are enough for stable, long-term keywords and cost less. A good setup checks money keywords daily and the long tail weekly.

## Read trends, not noise

Positions move a little every day. Look at trends over weeks:

- **Visibility** sums up all keywords into one number weighted by expected clicks, so a move from 11 to 4 counts far more than a move from 48 to 41.
- **Best position** shows how high a page has ever been.
- **SERP features** (AI overviews, featured snippets, local packs, videos) explain why a top-3 position may still get few clicks.
- **Competitors** show whether you dropped or someone else climbed.

## Act on what you see

A keyword that drops sharply usually means a technical problem (a page returning an error, a stray noindex, a broken redirect) or a stronger competitor. Run a site audit, compare the ranking URL with your target page, and look at who moved above you. Set alerts for top 3 and top 10 entries and exits, so the important moves reach you without opening a dashboard.`,
  },
  {
    slug: "common-technical-seo-issues",
    title: "The 10 most common technical SEO issues (and how to fix them)",
    excerpt: "Before you write another article, make sure search engines can crawl, index and understand the pages you already have. These are the issues we find on almost every site.",
    metaDescription: "The 10 most common technical SEO issues found in site audits: broken links, redirect chains, noindex, canonicals, duplicate titles, meta descriptions, HTTPS, sitemaps, alt text and speed.",
    content: `Every site audit is different, but the same problems show up again and again. Here are the ten we see most often, why they matter and how to fix each one.

## 1. Broken internal links

**What it is:** links on your own site that lead to a 404 or a server error.
**Why it matters:** visitors hit a dead end, and search engines waste crawl budget on pages that don't exist.
**Fix:** update the link to the right URL, or redirect the old URL (301) to its closest replacement. Re-run the audit to confirm.

## 2. Redirect chains and loops

**What it is:** URL A redirects to B, which redirects to C (or back to A).
**Why it matters:** every hop slows the page down and may lose some link value; loops make a page unreachable.
**Fix:** point the first redirect straight at the final URL, and update internal links to the final URL so no redirect is needed at all.

## 3. Pages accidentally set to noindex

**What it is:** a \`<meta name="robots" content="noindex">\` tag or an X-Robots-Tag header on a page you want in Google, often left over from a staging site.
**Fix:** remove the tag from pages that should rank, then request indexing in Google Search Console.

## 4. Missing or wrong canonical tags

**What it is:** no canonical tag, or a canonical that points to another page, a redirect or a broken URL.
**Why it matters:** Google may index the wrong version of a page or ignore it.
**Fix:** give every indexable page a self-referencing canonical, and point duplicates (filtered or tracking URLs) to the main version.

## 5. Duplicate or missing titles

**What it is:** pages without a title tag, or many pages sharing the same one.
**Fix:** write a unique title of about 30–60 characters for every page, with the main topic near the start.

## 6. Missing or duplicate meta descriptions

**Why it matters:** the description isn't a ranking factor, but it's your ad text in the results. Without one, Google picks a random snippet.
**Fix:** write a unique, specific description of about 70–160 characters for important pages.

## 7. HTTP pages and mixed content

**What it is:** pages served over plain HTTP, an http:// version that doesn't redirect to https://, or secure pages loading images and scripts over HTTP.
**Fix:** redirect all HTTP URLs to HTTPS with a single 301, and update hard-coded http:// links to resources.

## 8. Missing or broken XML sitemap and robots.txt

**What it is:** no sitemap, a sitemap listing redirected or deleted URLs, or a robots.txt that blocks important sections.
**Fix:** generate a sitemap with only your final, indexable URLs, reference it in robots.txt, and check that robots.txt doesn't disallow pages you want ranked.

## 9. Images without alt text

**Why it matters:** alt text helps screen-reader users and tells search engines what an image shows, which counts for image search.
**Fix:** describe meaningful images in a few words. Decorative images can have an empty alt attribute.

## 10. Slow server response and heavy pages

**What it is:** a slow time to first byte, no compression, very large HTML or dozens of scripts.
**Fix:** enable gzip or Brotli compression, cache pages, remove unused scripts and move to faster hosting if the server itself is slow.

## Make it a habit

Fixing these once isn't enough: new pages, plugins and redesigns bring problems back. Run an audit every month (or after every release), and compare it with the previous one. The list of **new** issues shows what just broke; the list of **fixed** issues is proof of your work, and it looks great in a client report.`,
  },
  {
    slug: "white-label-seo-reports-clients-read",
    title: "Building white-label SEO reports clients actually read",
    excerpt: "Most SEO reports are 30 pages of charts nobody opens. A good report answers three questions in under a minute and carries your brand, not your tool's.",
    metaDescription: "How to build white-label SEO reports for clients: the three questions every report must answer, the metrics to include, branding, live links vs PDF, scheduling and commentary.",
    content: `## The three questions

Every client wants to know:

1. **Are we getting more visible on Google?**
2. **What did you do for us?**
3. **What happens next?**

Put the answers at the top. Everything else is supporting detail for the people who want it.

## Metrics that mean something

- **Visibility trend** across all tracked keywords, not one vanity keyword.
- **Keywords in the top 3 and top 10**, with the biggest winners and losers of the period.
- **Search Console clicks and impressions**, which connect rankings to real traffic.
- **Site health score** from the latest audit, with the issues fixed since last time.

Leave out what the client can't act on or doesn't understand. Average position across 2,000 long-tail keywords is noise; "12 more keywords on page one" is a story.

## Make it yours: white-label

The report is part of your service, so it should look like it. Use your logo, your brand colour and your company name, and drop the "powered by" line of the tool you use. Clients buy expertise from you, not a software subscription, and a branded report reminds them of that every month.

## Live links beat PDFs

A PDF is out of date the day after you send it, and it gets lost in inboxes. A live report link always shows the latest data for the period the client picks (the last 7, 30 or 90 days, for example). Protect it with a password if the numbers are sensitive, and keep the PDF for clients who need a file for their records.

## Schedule it, then forget it

Send the report on a fixed rhythm: weekly for active campaigns, monthly for maintenance clients. A scheduled email with the headline numbers and a link to the full report means the client never has to ask "how are we doing?", and you never have to copy numbers into slides again.

## Add a badge for public proof

An SEO health badge on the client's own website (a small "SEO health 91/100" pill) is a quiet, always-current reminder of the work you do. Only use it for numbers the client is happy to show in public.

## Explain, don't just show

Add two or three sentences: why a keyword dropped, which fix moved the health score, what you will work on next month. That short note is what clients remember, and what keeps them working with you.

## A simple monthly template

1. **Headline:** visibility up or down, and by how much.
2. **Wins:** the three keywords that improved most, with their new position.
3. **Work done:** issues fixed in the site audit, pages published or improved.
4. **Watch list:** keywords that dropped and what you're doing about them.
5. **Next month:** two or three planned actions.

Five short sections, readable in a minute, with the full data one click away.`,
  },
];
