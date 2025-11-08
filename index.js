#!/usr/bin/env node
// This is the main CLI entry for queuectl. It parses flags and runs commands.
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { loadConfig } from "./src/config/index.js";
import { makeRoutes } from "./src/routes/cliRoutes.js";
import { initLogger, readWorkersRuntime } from "./src/utils/logger.js";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  countByState,
  listJobIdsByState,
  countProcessingWorkers,
} from "./src/services/jobService.js";
import { disconnectMongo } from "./src/db/mongo.js";

// Lightweight static server to host src/public when workers are running.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let __dashServer = null;
let shouldDisconnect = true;

function markLongRunningCommand() {
  shouldDisconnect = false;
}

function startDashboardServer(port, config) {
  if (__dashServer || !Number.isFinite(port)) return;
  config = config || {};
  const publicDir = path.resolve(__dirname, "src/public");
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  async function computeStatus() {
    const [counts, runtime, leaseWorkers] = await Promise.all([
      countByState(config),
      readWorkersRuntime(),
      countProcessingWorkers(config),
    ]);
    let workers = 0;
    if (runtime && Number.isFinite(Number(runtime.count)))
      workers = Number(runtime.count);
    if (!workers && leaseWorkers) workers = leaseWorkers;
    // Refresh interval from env (.env): supports REFRESH_MS or REFRESH_SECONDS
    const envMs = Number(process.env.REFRESH_MS);
    const envSec = Number(
      process.env.REFRESH_SECONDS ||
        process.env.REFRESH_INTERVAL ||
        process.env.DASHBOARD_REFRESH_SEC
    );
    const refresh_ms = Number.isFinite(envMs)
      ? Math.max(500, envMs)
      : Number.isFinite(envSec)
      ? Math.max(1, envSec) * 1000
      : 30000;
    return { ...counts, workers, refresh_ms };
  }
  async function listByState(state) {
    const ids = await listJobIdsByState(config, state);
    return ids;
  }
  __dashServer = http
    .createServer((req, res) => {
      (async () => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }
        const url = new URL(req.url, `http://localhost:${port}`);
        // API endpoints
        if (url.pathname === "/api/status") {
          const s = await computeStatus();
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(s));
          return;
        }
        if (url.pathname === "/api/list") {
          const state = String(
            url.searchParams.get("state") || ""
          ).toLowerCase();
          const ids = await listByState(state);
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ state, ids }));
          return;
        }
        let reqPath = decodeURIComponent(url.pathname);
        if (reqPath === "/" || reqPath === "") reqPath = "/index.html";
        // Prevent path traversal
        const safePath = path.normalize(reqPath).replace(/^\\+|^\/+/, "");
        const filePath = path.join(publicDir, safePath);
        if (!filePath.startsWith(publicDir)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader("Content-Type", types[ext] || "application/octet-stream");
        fs.createReadStream(filePath).pipe(res);
      })().catch((e) => {
        res.statusCode = 500;
        res.end("Server Error");
      });
    })
    .listen(port, () => {
      console.log(`Dashboard available at http://localhost:${port}`);
    });
  __dashServer.on("error", (e) => {
    console.error(`Dashboard server error on port ${port}:`, e.message);
  });
}

function maybeStartDashboard(rawArgs, config) {
  const portStr = (process.env.PORT || "").toString().trim();
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) return;
  const ix = rawArgs.findIndex((a) => String(a).toLowerCase() === "worker");
  if (ix < 0) return; // only start when using worker command
  const action = (rawArgs[ix + 1] || "start").toLowerCase();
  if (action === "stop") return;
  // If explicitly detached, avoid keeping this process running
  const detached = rawArgs.some((a) => String(a).startsWith("--detach"));
  if (detached) return;
  startDashboardServer(port, config);
}

const cli = yargs(hideBin(process.argv))
  .option("QUEUE_ROOT", { type: "string" })
  .option("LOG_DIR", { type: "string" })
  .option("CONCURRENCY", { type: "number" })
  .option("MAX_RETRIES", { type: "number" })
  .option("BACKOFF_BASE", { type: "number" })
  .option("MAX_BACKOFF_SEC", { type: "number" })
  .option("JOB_TIMEOUT_MS", { type: "number" })
  .middleware([
    (argv) => {
      const config = loadConfig(argv);
      initLogger(config.MONGODB_URI);
      argv.__config = config;
      argv.__rawArgs = process.argv.slice(2);
      try {
        maybeStartDashboard(argv.__rawArgs, config);
      } catch {}
    },
  ])
  .scriptName("queuectl")
  .usage("$0 <cmd> [args]")
  .help(false)
  .version(false)
  .fail((msg, err) => {
    if (err && err.message) {
      console.error(err.message);
    } else if (msg) {
      console.error(msg);
    } else {
      console.error("Command failed");
    }
    process.exit(1);
  });
makeRoutes(cli, { markLongRunningCommand });

// Extra command: serve the dashboard even if workers are not running.
cli.command(
  "dashboard",
  "Serve local dashboard from src/public using PORT in .env",
  () => {},
  (argv) => {
    const portStr = (process.env.PORT || "").toString().trim();
    const port = Number(portStr);
    if (!Number.isFinite(port) || port <= 0) {
      console.error("Set PORT in .env (e.g., PORT=9000)");
      process.exitCode = 1;
      return;
    }
    startDashboardServer(
      port,
      argv.__config || { MONGODB_URI: process.env.MONGODB_URI }
    );
    markLongRunningCommand();
    console.log("Press Ctrl+C to stop");
  }
);

const configuredCli = cli.demandCommand(1).strict();

try {
  await configuredCli.parseAsync();
} finally {
  if (shouldDisconnect) {
    await disconnectMongo();
  }
}
