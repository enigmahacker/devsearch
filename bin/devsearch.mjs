#!/usr/bin/env node
// DevSearch local runner: copies the app into a folder, starts the stores in Docker, then the API and the web app.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COPY = ["api", "workers", "web", "docker-compose.yml", "pyproject.toml", "uv.lock", ".env.example", "README.md"];
const NAME = "@aryptn/devsearch";
const VERSION = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;
const SKIP = new Set(["node_modules", ".next", ".venv", "__pycache__", ".pytest_cache", ".vercel", "tsconfig.tsbuildinfo"]);

const [cmd, arg] = process.argv[2] && !["start", "stop", "update", "help", "-h", "--help", "-v", "--version"].includes(process.argv[2])
  ? ["start", process.argv[2]] : [process.argv[2] ?? "start", process.argv[3]];
// One fixed home by default, so `ds` works from any folder without scattering copies.
const dir = resolve(arg ?? process.env.DEVSEARCH_HOME ?? join(homedir(), "devsearch"));
// npm is npm.cmd on Windows, and Node only runs .cmd files through a shell.
const shell = process.platform === "win32";

if (cmd === "help" || cmd === "-h" || cmd === "--help") {
  console.log(`Usage:
  ds [dir]        set up (first run), start DevSearch and open it in the browser
  ds stop [dir]   stop the Docker stores
  ds update       update DevSearch to the latest version
  ds --version    show the installed version
  ds help         this help

dir defaults to $DEVSEARCH_HOME or ~/devsearch. Ports: PORT (web, default 3000), API_PORT (default 8000); a busy port moves to the next free one.

Needs Docker, uv (https://docs.astral.sh/uv/) and Node 20.12+. Then open http://localhost:3000
and add your model provider key in Settings.`);
  process.exit(0);
}
if (cmd === "-v" || cmd === "--version") {
  console.log(VERSION);
  process.exit(0);
}

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { cwd: dir, stdio: "inherit", shell, ...opts });
  if (r.status !== 0) die(`${bin} ${args.join(" ")} failed`);
}
function die(msg) {
  console.error(`devsearch: ${msg}`);
  process.exit(1);
}
function need(bin, hint) {
  if (spawnSync(bin, ["--version"], { stdio: "ignore", shell }).status !== 0) die(`${bin} not found. ${hint}`);
}

/** Latest published version, or null when offline (never blocks or fails the start). */
async function latest() {
  try {
    const r = await fetch(`https://registry.npmjs.org/${NAME.replace("/", "%2f")}/latest`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? (await r.json()).version : null;
  } catch {
    return null;
  }
}
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

if (cmd === "update") {
  const next = await latest();
  if (!next) die("could not reach the npm registry");
  if (!newer(next, VERSION)) {
    console.log(`DevSearch ${VERSION} is up to date.`);
    process.exit(0);
  }
  console.log(`Updating DevSearch ${VERSION} -> ${next}`);
  need("npm", "Install Node.js 20.12+: https://nodejs.org");
  run("npm", ["install", "-g", `${NAME}@${next}`], { cwd: homedir() });
  console.log(`Updated to ${next}. Run \`ds\` to start; it refreshes the app in ${dir} and keeps your .env and data.`);
  process.exit(0);
}

need("docker", "Install Docker Desktop: https://docs.docker.com/get-docker/");
if (cmd === "stop") {
  if (!existsSync(join(dir, "docker-compose.yml"))) die(`no DevSearch app in ${dir}`);
  run("docker", ["compose", "down"]);
  process.exit(0);
}
need("uv", "Install uv: https://docs.astral.sh/uv/getting-started/installation/");
need("npm", "Install Node.js 20.12+: https://nodejs.org");

// Copy the app on first run, and refresh its code after `npm i -g` brings a new version. .env and data are kept.
const stamp = join(dir, ".devsearch-version");
const fresh = !existsSync(join(dir, "pyproject.toml"));
const stale = !fresh && PKG !== dir && (existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "") !== VERSION;
if (fresh || stale) {
  console.log(`${fresh ? "Creating" : `Updating to ${VERSION}:`} DevSearch in ${dir}`);
  // Never copy secrets (.env, .env.local...) even if a dev build of the package contains them.
  // shortcut: files deleted upstream linger in dir; switch to a clean re-copy if that ever matters.
  const keep = (p) => !SKIP.has(basename(p)) && !/^\.env(?!\.example$)/.test(basename(p));
  for (const f of COPY) if (existsSync(join(PKG, f))) cpSync(join(PKG, f), join(dir, f), { recursive: true, filter: keep });
  writeFileSync(stamp, VERSION + "\n");
}
if (!existsSync(join(dir, ".env"))) copyFileSync(join(dir, ".env.example"), join(dir, ".env"));

run("docker", ["compose", "up", "-d", "--wait"]);
run("uv", ["sync"]);
if (stale || !existsSync(join(dir, "web", "node_modules"))) run("npm", ["--prefix", "web", "install"]);
const seeded = join(dir, ".devsearch-seeded");
if (!existsSync(seeded)) {
  run("uv", ["run", "--env-file", ".env", "python", "-m", "workers.run", "--fixtures"]);
  writeFileSync(seeded, new Date().toISOString() + "\n");
}

// Say when a newer version is out; the check runs alongside the start and stays silent offline.
latest().then((v) => v && newer(v, VERSION) && console.log(`\nDevSearch ${v} is available (you have ${VERSION}). Run \`ds update\`.\n`));

// The web app gets the same .env (SUPPORT_URL, AUTH_*); Next.js would otherwise only read web/.env*.
// Take the next free port, so a busy 3000/8000 never crashes the start or opens someone else's app.
const free = (port) => new Promise((ok) => {
  const s = createServer().once("error", () => ok(false)).listen(port, "127.0.0.1", () => s.close(() => ok(true)));
});
async function pick(start) {
  for (let p = Number(start); p < Number(start) + 50; p++) if (await free(p)) return String(p);
  die(`no free port near ${start}`);
}
const apiPort = await pick(process.env.API_PORT ?? "8000");
const webPort = await pick(process.env.PORT ?? "3000");
const env = { ...process.env, API_URL: `http://127.0.0.1:${apiPort}`, PORT: webPort, ...parseEnv(readFileSync(join(dir, ".env"), "utf8")) };
const procs = [
  spawn("uv", ["run", "--env-file", ".env", "uvicorn", "api.app.main:app", "--host", "127.0.0.1", "--port", apiPort], { cwd: dir, stdio: "inherit", shell }),
  // Loopback only: login is off in dev, so the app must not be reachable from the LAN.
  spawn("npm", ["--prefix", "web", "run", "dev", "--", "-H", "127.0.0.1", "-p", webPort], { cwd: dir, stdio: "inherit", env, shell }),
];
console.log(`\nDevSearch: http://127.0.0.1:${webPort} (API http://127.0.0.1:${apiPort}). Ctrl-C to stop; \`ds stop\` stops Docker.\n`);
const stop = (code) => { for (const p of procs) p.kill("SIGTERM"); process.exit(code); };
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
for (const p of procs) p.on("exit", (code) => stop(code ?? 1));

// Open the browser once the web app answers (up to 2 minutes for the first compile).
const url = `http://127.0.0.1:${webPort}`;
const opener = process.platform === "darwin" ? ["open", [url]] : shell ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
(async () => {
  for (let i = 0; i < 120; i++) {
    if (await fetch(url, { redirect: "manual" }).then(() => true, () => false)) {
      spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
})();
