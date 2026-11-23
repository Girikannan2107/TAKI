#!/usr/bin/env node
// TAKI local development: Firebase emulators + FastAPI (uvicorn --reload) + Next.js, together.
//
//   node scripts/dev.mjs                 # emulators (auth, firestore, storage) + api :8000 + web :3000
//   node scripts/dev.mjs --no-emulators  # use your own project / already-running emulators
//   node scripts/dev.mjs --no-web        # emulators + api only
//   node scripts/dev.mjs --no-api        # emulators + web only
//
// Needs: Node 20+, Java 21 on PATH (Firestore/Storage emulators), firebase-tools (apps/web devDependency
// or global), and the backend venv: py -3.12 -m venv backend/.venv && backend/.venv/Scripts/python -m pip
// install -r backend/requirements-dev.txt (see docs/v3/local-setup.md).
//
// Logs are prefixed [emu] [api] [web]. Ctrl+C stops every process tree (taskkill /T on Windows).
// If any child exits, the others are stopped too.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
const args = new Set(process.argv.slice(2));
const want = {
  emulators: !args.has("--no-emulators"),
  api: !args.has("--no-api"),
  web: !args.has("--no-web"),
};

const PROJECT = "demo-taki";
const PORTS = { auth: 9099, firestore: 8080, storage: 9199 };
const COLORS = { emu: "\x1b[35m", api: "\x1b[36m", web: "\x1b[32m", dev: "\x1b[33m" };
const RESET = "\x1b[0m";

function log(tag, line) {
  const color = process.stdout.isTTY ? COLORS[tag] ?? "" : "";
  process.stdout.write(`${color}[${tag}]${color ? RESET : ""} ${line}\n`);
}

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes). */
function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value !== "") out[key] = value;
  }
  return out;
}

function findFirebaseCli() {
  const local = path.join(ROOT, "apps", "web", "node_modules", ".bin", IS_WIN ? "firebase.cmd" : "firebase");
  if (existsSync(local)) return local;
  const rootLocal = path.join(ROOT, "node_modules", ".bin", IS_WIN ? "firebase.cmd" : "firebase");
  if (existsSync(rootLocal)) return rootLocal;
  return IS_WIN ? "firebase.cmd" : "firebase";
}

function venvPython() {
  const p = IS_WIN ? path.join(ROOT, "backend", ".venv", "Scripts", "python.exe") : path.join(ROOT, "backend", ".venv", "bin", "python");
  return existsSync(p) ? p : null;
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    s.setTimeout(1000, () => {
      s.destroy();
      resolve(false);
    });
  });
}

async function waitForPorts(ports, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await Promise.all(ports.map((p) => portOpen(p)));
    if (open.every(Boolean)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const children = [];
let shuttingDown = false;

function pipeLines(stream, tag) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      log(tag, buf.slice(0, i).replace(/\r$/, ""));
      buf = buf.slice(i + 1);
    }
  });
  stream.on("end", () => buf && log(tag, buf));
}

function start(tag, command, argv, options) {
  log("dev", `starting ${tag}: ${path.basename(command)} ${argv.join(" ")}`);
  // .cmd shims need a shell on Windows; arguments here are fixed strings (no user input).
  const useShell = IS_WIN && /\.(cmd|bat)$/i.test(command);
  const child = spawn(useShell ? `"${command}"` : command, argv, {
    ...options,
    shell: useShell,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  pipeLines(child.stdout, tag);
  pipeLines(child.stderr, tag);
  child.on("exit", (code, signal) => {
    log("dev", `${tag} exited (${signal ?? code})`);
    if (!shuttingDown) shutdown(code ?? 1);
  });
  child.on("error", (err) => {
    log("dev", `${tag} failed to start: ${err.message}`);
    if (!shuttingDown) shutdown(1);
  });
  children.push({ tag, child });
  return child;
}

function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (IS_WIN) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("dev", "stopping…");
  // Stop web and api first, emulators last (they export data on exit).
  for (const { child } of [...children].reverse()) killTree(child);
  setTimeout(() => process.exit(code), IS_WIN ? 500 : 3000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const fileEnv = { ...loadEnvFile(path.join(ROOT, "backend", ".env")), ...loadEnvFile(path.join(ROOT, "backend", ".env.local")) };
  const emulatorEnv = {
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${PORTS.firestore}`,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${PORTS.auth}`,
    FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${PORTS.storage}`,
  };

  if (want.emulators) {
    const already = await Promise.all(Object.values(PORTS).map((p) => portOpen(p)));
    if (already.every(Boolean)) {
      log("dev", "emulators already running on 9099/8080/9199; reusing them");
    } else {
      const java = spawnSync(IS_WIN ? "java.exe" : "java", ["-version"], { stdio: "ignore" });
      if (java.status !== 0) log("dev", "WARNING: `java` not found. The Firestore/Storage emulators need Java 21 on PATH.");
      start(
        "emu",
        findFirebaseCli(),
        [
          "emulators:start",
          "--config",
          "firebase/firebase.json",
          "--only",
          "auth,firestore,storage",
          "--project",
          PROJECT,
          "--import",
          "firebase/.data/emulators",
          "--export-on-exit",
        ],
        { cwd: ROOT, env: process.env, detached: !IS_WIN },
      );
      log("dev", "waiting for emulators (auth 9099, firestore 8080, storage 9199)…");
      if (!(await waitForPorts(Object.values(PORTS), 120_000))) {
        log("dev", "emulators did not start within 120 s");
        return shutdown(1);
      }
      log("dev", "emulators ready (UI http://127.0.0.1:4000)");
    }
  }

  if (want.api) {
    const py = venvPython();
    if (!py) {
      log("dev", "backend/.venv not found. Create it: py -3.12 -m venv backend/.venv && backend/.venv/Scripts/python -m pip install -r backend/requirements-dev.txt");
      return shutdown(1);
    }
    const apiEnv = {
      ...process.env,
      APP_ENV: "development",
      FIREBASE_PROJECT_ID: PROJECT,
      PAYMENT_PROVIDER: "dev",
      CORS_ALLOWED_ORIGINS: "http://localhost:3000",
      LOG_JSON: "false",
      ...(want.emulators ? emulatorEnv : {}),
      ...fileEnv, // backend/.env(.local) wins (e.g. PAYMENT_PROVIDER=cashfree with sandbox keys)
      PYTHONUNBUFFERED: "1",
    };
    // Keep-alive above Node's 5 s agent idle timeout, or the Next proxy hits ECONNRESET (see playwright.config.ts).
    start("api", py, ["-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000", "--timeout-keep-alive", "75"], {
      cwd: path.join(ROOT, "backend"),
      env: apiEnv,
      detached: !IS_WIN,
    });
  }

  if (want.web) {
    const npm = IS_WIN ? "npm.cmd" : "npm";
    start("web", npm, ["--prefix", "apps/web", "run", "dev"], {
      cwd: ROOT,
      env: { ...process.env, NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${PORTS.auth}` },
      detached: !IS_WIN,
    });
  }

  if (children.length === 0) log("dev", "nothing to start");
}

main().catch((err) => {
  log("dev", `error: ${err?.stack ?? err}`);
  shutdown(1);
});
