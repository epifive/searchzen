"""Turn raw screenshots and rendered templates into the final marketing images.

    node demo-extras.mjs          # optional sample data (see shoot.mjs for the full recipe)
    node shoot.mjs                # raw/  (needs the demo server, default http://localhost:5500)
    node render.mjs               # out/  (compositions, preview, thumbnail)
    python finalize.py            # final/
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
RAW, OUT, FINAL = HERE / "raw", HERE / "out", HERE / "final"
SHOTS = FINAL / "screenshots"


def img(src, box=None):
    """An image from raw/ or out/ (a Path), optionally cropped to box = (left, top, right, bottom)."""
    im = Image.open(src).convert("RGB")
    if box:
        l, t, r, b = box
        im = im.crop((l, t, min(r, im.width), min(b, im.height)))
    return im


def stack(*parts, gap=0, bg=(244, 246, 248)):
    """Images on top of each other (same width expected; narrower ones are centred)."""
    width = max(p.width for p in parts)
    height = sum(p.height for p in parts) + gap * (len(parts) - 1)
    canvas = Image.new("RGB", (width, height), bg)
    y = 0
    for p in parts:
        canvas.paste(p, ((width - p.width) // 2, y))
        y += p.height + gap
    return canvas


R = lambda name: RAW / f"{name}.png"  # noqa: E731
O = lambda name: OUT / f"{name}.png"  # noqa: E731

# (file name, builder) in upload order.
ORDER = [
    ("01-features", lambda: img(O("features"))),
    ("02-home", lambda: img(R("l01-home-hero"))),
    ("03-project-overview", lambda: img(R("d02-overview-30"))),
    ("04-project-overview-90-days", lambda: img(R("d02c-overview-90"))),
    ("05-all-projects", lambda: img(R("d01-projects"))),
    ("06-rankings-kpis-charts", lambda: img(R("d03-rankings"))),
    ("07-keywords-table-tags-filter", lambda: img(R("d04-rankings-filtered"))),
    ("08-add-keywords-csv-import", lambda: img(R("d05-add-keywords"))),
    ("09-keyword-position-history", lambda: img(R("d06-keyword-detail"))),
    ("10-serp-snapshot-serp-features", lambda: img(R("d06b-serp-snapshot"))),
    ("11-competitors-share-of-voice", lambda: img(R("d07-competitors"))),
    ("12-site-audit-health-score", lambda: img(R("d08b-audit-full"))),
    ("13-site-audit-in-progress", lambda: img(R("d09-audit-running"))),
    ("14-audit-issues-how-to-fix", lambda: img(R("d10b-issue-expanded"))),
    ("15-audit-new-issues-since-last-audit", lambda: img(R("d10c-issues-new"))),
    ("16-audit-pages-explorer", lambda: img(R("d11-audit-pages"))),
    ("17-audit-page-detail", lambda: img(R("d11c-audit-page-full"))),
    ("18-search-console", lambda: img(R("d12-gsc"))),
    ("19-search-console-queries-pages", lambda: stack(img(R("d12b-gsc-queries"), (256, 150, 1440, 900)), img(R("d12c-gsc-pages"), (256, 230, 1440, 880)), gap=0)),
    ("20-white-label-client-reports", lambda: img(O("reports"))),
    ("21-public-report-link", lambda: img(R("p1-public-report"))),
    ("22-report-site-audit-search-console", lambda: img(R("p1c-public-report-audit-gsc"), (0, 0, 1440, 1600))),
    ("23-report-pdf-print-layout", lambda: img(O("print"))),
    ("24-report-password", lambda: img(R("p3-report-password"))),
    ("25-reports-share-link-schedules", lambda: img(R("d13-reports"))),
    ("26-seo-health-badge", lambda: img(R("d13c-badge"))),
    ("27-settings-competitors-checks-audit", lambda: img(R("d14g-settings-competitors-checks-audit"))),
    ("28-settings-alerts-branding-sharing", lambda: img(R("d14h-settings-alerts-branding-sharing"))),
    ("29-alert-channels", lambda: img(R("d15-alert-channels"))),
    ("30-api-keys-rest-api", lambda: img(R("d16-api-keys"))),
    ("31-mobile", lambda: img(O("mobile"))),
    ("32-languages-rtl", lambda: img(O("languages"))),
    ("33-arabic-rtl-dashboard", lambda: img(R("r1-overview-ar"))),
    ("34-landing-audit-and-report-showcase", lambda: stack(img(R("l05-audit-showcase")), img(R("l06-report-showcase")))),
    ("35-landing-integrations", lambda: img(R("l07-integrations"))),
    ("36-pricing-and-faq", lambda: stack(img(R("l11-pricing"), (0, 0, 1440, 1350)), img(R("l09-faq"), (0, 40, 1440, 900)))),
    ("37-dark-mode", lambda: img(R("l10-home-dark"))),
    ("38-admin-dashboard", lambda: img(R("a1-admin-dashboard"))),
    ("39-admin-users", lambda: img(R("a2-admin-users"))),
    ("40-admin-plans", lambda: img(R("a3-admin-plans"))),
    ("41-admin-serp-providers", lambda: img(R("a4-admin-rank-tracking"))),
    ("42-admin-google-and-seo-tools", lambda: stack(img(R("a5-admin-google"), (500, 96, 1412, 600)), img(R("a6-admin-seo-tools"), (500, 96, 1412, 840)), gap=8)),
    ("43-admin-languages", lambda: img(R("a7-admin-languages"))),
    ("44-admin-system-scheduler", lambda: img(R("a8-admin-system"))),
    ("45-web-installer", lambda: img(R("i2-installer-database"))),
]

SHOTS.mkdir(parents=True, exist_ok=True)
for old in SHOTS.glob("*.jpg"):
    old.unlink()
for name, build in ORDER:
    build().save(SHOTS / f"{name}.jpg", "JPEG", quality=88, optimize=True, progressive=True)

Image.open(OUT / "preview-590x300.png").convert("RGB").save(FINAL / "preview-590x300.jpg", "JPEG", quality=92, optimize=True)
Image.open(OUT / "thumbnail-80x80.png").save(FINAL / "thumbnail-80x80.png", optimize=True)

thumb = (FINAL / "thumbnail-80x80.png").stat().st_size
size = Image.open(FINAL / "preview-590x300.jpg").size
print(f"{len(ORDER)} screenshots, preview {size} {(FINAL / 'preview-590x300.jpg').stat().st_size // 1024} KB, thumbnail {thumb / 1024:.1f} KB")
if thumb >= 50 * 1024 or size != (590, 300):
    raise SystemExit("thumbnail or preview is not the expected size")
