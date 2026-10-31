// Renders the HTML templates in ./templates to PNG with headless Chrome (CDP).
//
//   node render.mjs                                   renders every composition below into ./out
//   node render.mjs <template.html> <out.png> <width> <height> [transparent 0|1] ...
//
// Run `node shoot.mjs` first: the templates use the screenshots in ./raw.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, sleep } from "./lib/cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = (f) => path.join(HERE, "templates", f);
const O = (f) => path.join(HERE, "out", f);

const DEFAULT_JOBS = [
  { template: T("features.html"), out: O("features.png"), width: 1440, height: 790 },
  { template: T("reports.html"), out: O("reports.png"), width: 1440, height: 900 },
  { template: T("print.html"), out: O("print.png"), width: 1440, height: 1000 },
  { template: T("mobile.html"), out: O("mobile.png"), width: 1440, height: 1000 },
  { template: T("languages.html"), out: O("languages.png"), width: 1440, height: 1000 },
  { template: T("preview.html"), out: O("preview-590x300.png"), width: 590, height: 300 },
  { template: T("thumbnail.html"), out: O("thumbnail-80x80.png"), width: 80, height: 80, transparent: true },
];

const args = process.argv.slice(2);
const jobs = [];
for (let i = 0; i + 3 < args.length; i += 5) {
  jobs.push({ template: path.resolve(args[i]), out: path.resolve(args[i + 1]), width: Number(args[i + 2]), height: Number(args[i + 3]), transparent: args[i + 4] === "1" });
}
if (!jobs.length) jobs.push(...DEFAULT_JOBS);
fs.mkdirSync(O(""), { recursive: true });

const { send, evaluate, close } = await launch(["--allow-file-access-from-files"]);
try {
  await send("Page.enable");
  for (const job of jobs) {
    await send("Emulation.setDeviceMetricsOverride", { width: job.width, height: job.height, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setDefaultBackgroundColorOverride", job.transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
    await send("Page.navigate", { url: pathToFileURL(job.template).href });
    await sleep(1200);
    await evaluate("Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {}))]).then(() => true)");
    await sleep(300);
    const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: job.width, height: job.height, scale: 1 } });
    fs.writeFileSync(job.out, Buffer.from(data, "base64"));
    console.log("rendered", path.basename(job.out));
  }
} finally {
  await close();
}
process.exit(0);
