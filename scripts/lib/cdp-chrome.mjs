// Mini cliente CDP: abre uma página HTML local no Chrome headless, emula viewport
// (desktop/celular), executa JS de medição e salva captura de página inteira.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

export async function withChrome(fn) {
  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(path.join(tmpdir(), "cdp-"));
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--remote-debugging-port=${port}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  let ws;
  try {
    let targets;
    for (let i = 0; i < 50; i += 1) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        if (targets.length) break;
      } catch { /* aguardando */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    const page = targets.find((t) => t.type === "page");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg);
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const myId = ++id;
      pending.set(myId, (msg) => (msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)));
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
    await send("Page.enable");
    await send("Runtime.enable");
    const api = {
      async open(file, { width = 900, height = 1000, mobile = false } = {}) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
        await send("Page.navigate", { url: pathToFileURL(file).href });
        await new Promise((r) => setTimeout(r, 900));
      },
      async goto(url, wait = 900) {
        await send("Page.navigate", { url });
        await new Promise((r) => setTimeout(r, wait));
      },
      async setOffline(offline) {
        await send("Network.enable");
        await send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      },
      async eval(expr) {
        const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
        return r.result.value;
      },
      async clip(out, x, y, width, height, scale = 3) {
        const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x, y, width, height, scale } });
        writeFileSync(out, Buffer.from(r.data, "base64"));
      },
      async shot(out, { clipHeight } = {}) {
        const h = clipHeight ?? (await api.eval("Math.ceil(document.documentElement.scrollHeight)"));
        const w = await api.eval("Math.ceil(document.documentElement.scrollWidth)");
        const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
        writeFileSync(out, Buffer.from(r.data, "base64"));
        return { width: w, height: h };
      },
    };
    return await fn(api);
  } finally {
    try { ws?.close(); } catch { /* noop */ }
    proc.kill();
  }
}
