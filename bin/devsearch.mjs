#!/usr/bin/env node
// DevSearch local runner: copies the app into a folder, starts the stores in Docker, then the API and the web app.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COPY = ["api", "workers", "web", "docker-compose.yml", "pyproject.toml", "uv.lock", ".env.example", "README.md"];
const SKIP = new Set(["node_modules", ".next", ".venv", "__pycache__", ".pytest_cache", ".vercel", "tsconfig.tsbuildinfo"]);

const [cmd, arg] = process.argv[2] && !["start", "stop", "help", "-h", "--help"].includes(process.argv[2])
  ? ["start", process.argv[2]] : [process.argv[2] ?? "start", process.argv[3]];
// One fixed home by default, so `ds` works from any folder without scattering copies.
const dir = resolve(arg ?? process.env.DEVSEARCH_HOME ?? join(homedir(), "devsearch"));
// npm is npm.cmd on Windows, and Node only runs .cmd files through a shell.
const shell = process.platform === "win32";

if (cmd === "help" || cmd === "-h" || cmd === "--help") {
  console.log(`Usage:
  ds [dir]        set up (first run), start DevSearch and open it in the browser
  ds stop [dir]   stop the Docker stores
  ds help         this help

dir defaults to $DEVSEARCH_HOME or ~/devsearch. Ports: PORT (web, default 3000), API_PORT (default 8000).

Needs Docker, uv (https://docs.astral.sh/uv/) and Node 20.12+. Then open http://localhost:3000
and add your model provider key in Settings.`);
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

need("docker", "Install Docker Desktop: https://docs.docker.com/get-docker/");
if (cmd === "stop") {
  if (!existsSync(join(dir, "docker-compose.yml"))) die(`no DevSearch app in ${dir}`);
  run("docker", ["compose", "down"]);
  process.exit(0);
}
need("uv", "Install uv: https://docs.astral.sh/uv/getting-started/installation/");
need("npm", "Install Node.js 20.12+: https://nodejs.org");

if (!existsSync(join(dir, "pyproject.toml"))) {
  console.log(`Creating DevSearch in ${dir}`);
  // Never copy secrets (.env, .env.local...) even if a dev build of the package contains them.
  const keep = (p) => !SKIP.has(basename(p)) && !/^\.env(?!\.example$)/.test(basename(p));
  for (const f of COPY) if (existsSync(join(PKG, f))) cpSync(join(PKG, f), join(dir, f), { recursive: true, filter: keep });
}
if (!existsSync(join(dir, ".env"))) copyFileSync(join(dir, ".env.example"), join(dir, ".env"));

run("docker", ["compose", "up", "-d", "--wait"]);
run("uv", ["sync"]);
if (!existsSync(join(dir, "web", "node_modules"))) run("npm", ["--prefix", "web", "install"]);
const seeded = join(dir, ".devsearch-seeded");
if (!existsSync(seeded)) {
  run("uv", ["run", "--env-file", ".env", "python", "-m", "workers.run", "--fixtures"]);
  writeFileSync(seeded, new Date().toISOString() + "\n");
}

// The web app gets the same .env (SUPPORT_URL, AUTH_*); Next.js would otherwise only read web/.env*.
const apiPort = process.env.API_PORT ?? "8000";
const webPort = process.env.PORT ?? "3000";
const env = { ...process.env, API_URL: `http://127.0.0.1:${apiPort}`, PORT: webPort, ...parseEnv(readFileSync(join(dir, ".env"), "utf8")) };
const procs = [
  spawn("uv", ["run", "--env-file", ".env", "uvicorn", "api.app.main:app", "--host", "127.0.0.1", "--port", apiPort], { cwd: dir, stdio: "inherit", shell }),
  // Loopback only: login is off in dev, so the app must not be reachable from the LAN.
  spawn("npm", ["--prefix", "web", "run", "dev", "--", "-H", "127.0.0.1"], { cwd: dir, stdio: "inherit", env, shell }),
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
