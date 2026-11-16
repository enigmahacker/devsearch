// Renders reel.html to a 30s 1080x1920 MP4 with no npm deps: headless Chrome over CDP, frames piped into ffmpeg.
//   node render-reel.mjs        (needs Google Chrome and ffmpeg)
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const here = import.meta.dirname;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FPS = 30, SECONDS = 30, PORT = 9333;
const out = join(here, "devsearch-v1.0.5-reel.mp4");

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--hide-scrollbars", "--force-color-profile=srgb",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "reel-"))}`, "about:blank"], { stdio: "ignore" });
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await new Promise((r) => setTimeout(r, 200));
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  if (!target) throw new Error("Chrome did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    waiting.set(++id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: pathToFileURL(join(here, "reel.html")).href });
  await new Promise((r) => setTimeout(r, 1500)); // fonts and layout settle

  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const total = FPS * SECONDS;
  for (let f = 0; f < total; f++) {
    await send("Runtime.evaluate", { expression: `seek(${(f * 1000) / FPS})` });
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    if (!ff.stdin.write(Buffer.from(data, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % FPS === 0) process.stdout.write(`\r${f / FPS}s / ${SECONDS}s`);
  }
  ff.stdin.end();
  const code = await new Promise((r) => ff.on("close", r));
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  console.log(`\nwrote ${out}`);
  ws.close();
} finally {
  chrome.kill();
}
