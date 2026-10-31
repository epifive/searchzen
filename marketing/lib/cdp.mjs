// Tiny Chrome DevTools Protocol helper shared by shoot.mjs and render.mjs.
// Starts headless Chrome on a random debugging port with a throw-away profile under
// the system temp folder (override with SHOT_TMP) and removes the profile on close().
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const TMP = process.env.SHOT_TMP ?? path.join(os.tmpdir(), "sz-mkt-chrome");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(extraArgs = []) {
  fs.mkdirSync(TMP, { recursive: true });
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(TMP, "sz-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--font-render-hinting=none",
    ...extraArgs,
    "about:blank",
  ]);

  let wsUrl;
  for (let i = 0; i < 150 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error("Chrome did not start");

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  const errors = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") errors.push("EXC " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split("\n")[0]);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("ERR " + msg.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push("LOG " + `${msg.params.entry.text} ${msg.params.entry.url ?? ""}`.slice(0, 200));
    if (msg.method) for (const l of [...listeners]) l(msg);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const waitFor = (method, timeout = 30000) =>
    new Promise((resolve) => {
      const l = (m) => {
        if (m.method === method) {
          listeners.splice(listeners.indexOf(l), 1);
          resolve(m.params);
        }
      };
      listeners.push(l);
      setTimeout(resolve, timeout);
    });
  async function evaluate(expression, contextId) {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async function close() {
    // Ask Chrome to quit and wait for the whole process tree to go, so the profile can be deleted.
    const exited = new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once("exit", r)));
    await Promise.race([send("Browser.close").catch(() => {}), sleep(2000)]);
    ws.close();
    await Promise.race([exited, sleep(8000)]);
    if (chrome.exitCode === null) chrome.kill();
    await sleep(1500);
    // Chrome's helper processes can hold files for a few more seconds on Windows.
    for (let i = 0; i < 60; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(1000);
      }
    }
    if (fs.existsSync(profile)) console.warn("could not delete", profile);
  }
  return { send, waitFor, evaluate, close, errors };
}
