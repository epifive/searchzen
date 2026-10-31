/**
 * Searchzen SEO health badge, bundled by scripts/build-widget.mjs into public/sz-badge.js
 * (budget: 2 KB gzip).
 *
 *   <script async src="https://PLATFORM/sz-badge.js" data-project="SHARE_TOKEN"></script>
 *
 * Renders a small "SEO health" pill right after the script tag. The score comes from
 * GET https://PLATFORM/api/badge/<token> → { score: number | null, label?: string, url?: string }
 * (when the request fails or the report link is not shared, the badge shows "–").
 * Options (data-*): project (share token), theme ("light" | "dark"), label (text before the score;
 * overrides the label returned by the API, which is only the platform's default).
 * Never throws and never blocks the page.
 */

interface BadgeData {
  score: number | null;
  label?: string;
  url?: string;
}

(() => {
  try {
    const d = document;
    const script = d.currentScript as HTMLScriptElement | null;
    if (!script) return;
    const attr = (k: string) => script.getAttribute("data-" + k) || "";
    const token = attr("project").replace(/[^A-Za-z0-9_-]/g, "");
    const origin = new URL(script.src).origin;
    const dark = attr("theme") === "dark";

    const a = d.createElement("a");
    a.href = origin;
    a.target = "_blank";
    a.rel = "noopener";
    a.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font:600 12px/1.4 system-ui,sans-serif;text-decoration:none;border:1px solid " +
      (dark ? "#334155;background:#0f172a;color:#e2e8f0" : "#cbd5e1;background:#fff;color:#0f172a");
    const dot = d.createElement("span");
    dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#94a3b8";
    const text = d.createElement("span");
    const own = attr("label");
    let label = own || "SEO health";
    const show = (data: BadgeData) => {
      const s = typeof data.score === "number" && isFinite(data.score) ? Math.max(0, Math.min(100, Math.round(data.score))) : null;
      if (!own && data.label) label = data.label;
      text.textContent = label + " " + (s === null ? "–" : s + "/100");
      dot.style.background = s === null ? "#94a3b8" : s >= 80 ? "#16a34a" : s >= 50 ? "#d97706" : "#dc2626";
      if (data.url && /^https?:\/\//.test(data.url)) a.href = data.url;
    };
    show({ score: null });
    a.appendChild(dot);
    a.appendChild(text);
    script.parentNode?.insertBefore(a, script.nextSibling);

    if (!token) return;
    fetch(origin + "/api/badge/" + token, { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BadgeData | null) => {
        if (data && typeof data === "object") show(data);
      })
      .catch(() => undefined);
  } catch {
    // Never break the host page.
  }
})();
