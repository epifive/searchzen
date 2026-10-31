// Bundles the embeddable SEO health badge (src/badge) into public/sz-badge.js.
// Runs automatically before `next dev` / `next build` (predev / prebuild) and via `npm run widget:build`.

import { build } from "esbuild";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "src/badge/index.ts");
const outfile = resolve(root, "public/sz-badge.js");
/** The badge must stay tiny: it is loaded on customers' websites. */
const MAX_GZIP = 2 * 1024;

if (!existsSync(entry)) {
  console.log("[badge] src/badge/index.ts not found: skipping public/sz-badge.js");
  process.exit(0);
}

try {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    minify: true,
    target: "es2017",
    platform: "browser",
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    write: false,
    logLevel: "warning",
  });

  const code = result.outputFiles[0].contents;
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, code);

  const gz = gzipSync(code, { level: 9 }).length;
  console.log(`[badge] public/sz-badge.js  ${code.length} B raw, ${gz} B gzip`);
  if (gz > MAX_GZIP) {
    console.error(`[badge] gzip size ${gz} B exceeds the ${MAX_GZIP} B budget`);
    process.exit(1);
  }
} catch (err) {
  console.error("[badge] build failed:", err && err.message ? err.message : err);
  process.exit(1);
}
