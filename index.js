#!/usr/bin/env node
// This is the main CLI entry for queuectl. It parses flags and runs commands.
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { loadConfig } from './src/config/index.js';
import { makeRoutes } from './src/routes/cliRoutes.js';
import { initLogger } from './src/utils/logger.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lightweight static server to host src/public when workers are running.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let __dashServer = null;

function startDashboardServer(port) {
  if (__dashServer || !Number.isFinite(port)) return;
  const publicDir = path.resolve(__dirname, 'src/public');
  const queueRoot = path.resolve(process.cwd(), process.env.QUEUE_ROOT || './data');
  const logDir = path.resolve(process.cwd(), process.env.LOG_DIR || './logs');
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  function listJsonFilesSync(dir) {
    try { return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).map((f) => path.join(dir, f)); } catch { return []; }
  }
  function readJsonSafe(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }
  function computeStatus() {
    const dirs = {
      queue: path.join(queueRoot, 'queue'),
      processing: path.join(queueRoot, 'processing'),
      archive: path.join(queueRoot, 'archive'),
      dlq: path.join(queueRoot, 'dlq'),
    };
    let pending = 0, failed = 0;
    for (const f of listJsonFilesSync(dirs.queue)) {
      const j = readJsonSafe(f);
      if (j && j.state === 'failed') failed++; else pending++;
    }
    const processingFiles = listJsonFilesSync(dirs.processing);
    const processing = processingFiles.length;
    const completed = listJsonFilesSync(dirs.archive).length;
    const dead = listJsonFilesSync(dirs.dlq).length;
    // Worker count from logs/workers.json if present, else unique workerId from processing
    let workers = 0;
    const wf = path.join(logDir, 'workers.json');
    if (fs.existsSync(wf)) {
      const j = readJsonSafe(wf);
      if (j && Number.isFinite(Number(j.count))) workers = Number(j.count);
    }
    if (!workers && processing > 0) {
      const set = new Set();
      for (const f of processingFiles) {
        const j = readJsonSafe(f);
        if (j && j.workerId) set.add(j.workerId);
      }
      workers = set.size;
    }
    // Refresh interval from env (.env): supports REFRESH_MS or REFRESH_SECONDS
    const envMs = Number(process.env.REFRESH_MS);
    const envSec = Number(process.env.REFRESH_SECONDS || process.env.REFRESH_INTERVAL || process.env.DASHBOARD_REFRESH_SEC);
    const refresh_ms = Number.isFinite(envMs)
      ? Math.max(500, envMs)
      : (Number.isFinite(envSec) ? Math.max(1, envSec) * 1000 : 30000);
    return { pending, failed, processing, completed, dead, workers, refresh_ms };
  }
  function listByState(state) {
    const dirs = {
      queue: path.join(queueRoot, 'queue'),
      processing: path.join(queueRoot, 'processing'),
      archive: path.join(queueRoot, 'archive'),
      dlq: path.join(queueRoot, 'dlq'),
    };
    const ids = [];
    if (state === 'completed') {
      for (const f of listJsonFilesSync(dirs.archive)) ids.push(path.basename(f).replace(/\.json$/i, ''));
    } else if (state === 'dead') {
      for (const f of listJsonFilesSync(dirs.dlq)) ids.push(path.basename(f).replace(/\.json$/i, ''));
    } else if (state === 'processing') {
      for (const f of listJsonFilesSync(dirs.processing)) ids.push(path.basename(f).replace(/\.json$/i, ''));
    } else if (state === 'pending' || state === 'failed') {
      for (const f of listJsonFilesSync(dirs.queue)) {
        const j = readJsonSafe(f);
        const s = (j && j.state) || 'pending';
        if (s === state) ids.push(path.basename(f).replace(/\.json$/i, ''));
      }
    }
    ids.sort();
    return ids;
  }
  __dashServer = http.createServer((req, res) => {
    try {
      if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
      const url = new URL(req.url, `http://localhost:${port}`);
      // API endpoints
      if (url.pathname === '/api/status') {
        const s = computeStatus();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(s));
        return;
      }
      if (url.pathname === '/api/list') {
        const state = String(url.searchParams.get('state') || '').toLowerCase();
        const ids = listByState(state);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ state, ids }));
        return;
      }
      let reqPath = decodeURIComponent(url.pathname);
      if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
      // Prevent path traversal
      const safePath = path.normalize(reqPath).replace(/^\\+|^\/+/, '');
      const filePath = path.join(publicDir, safePath);
      if (!filePath.startsWith(publicDir)) { res.statusCode = 403; res.end('Forbidden'); return; }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.statusCode = 404; res.end('Not Found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      res.statusCode = 500; res.end('Server Error');
    }
  }).listen(port, () => {
    console.log(`Dashboard available at http://localhost:${port}`);
  });
  __dashServer.on('error', (e) => {
    console.error(`Dashboard server error on port ${port}:`, e.message);
  });
}

function maybeStartDashboard(rawArgs) {
  const portStr = (process.env.PORT || '').toString().trim();
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) return;
  const ix = rawArgs.findIndex(a => String(a).toLowerCase() === 'worker');
  if (ix < 0) return; // only start when using worker command
  const action = (rawArgs[ix + 1] || 'start').toLowerCase();
  if (action === 'stop') return;
  // If explicitly detached, avoid keeping this process running
  const detached = rawArgs.some(a => String(a).startsWith('--detach'));
  if (detached) return;
  startDashboardServer(port);
}

const cli = yargs(hideBin(process.argv))
  .option('QUEUE_ROOT', { type: 'string' })
  .option('LOG_DIR', { type: 'string' })
  .option('CONCURRENCY', { type: 'number' })
  .option('MAX_RETRIES', { type: 'number' })
  .option('BACKOFF_BASE', { type: 'number' })
  .option('MAX_BACKOFF_SEC', { type: 'number' })
  .option('JOB_TIMEOUT_MS', { type: 'number' })
  .middleware([(argv) => {
    const config = loadConfig(argv);
    initLogger(config.LOG_DIR);
    argv.__config = config;
    argv.__rawArgs = process.argv.slice(2);
    try { maybeStartDashboard(argv.__rawArgs); } catch {}
  }])
  .scriptName('queuectl')
  .usage('$0 <cmd> [args]')
  .help(false)
  .version(false);
makeRoutes(cli);

// Extra command: serve the dashboard even if workers are not running.
cli.command(
  'dashboard',
  'Serve local dashboard from src/public using PORT in .env',
  () => {},
  (argv) => {
    const portStr = (process.env.PORT || '').toString().trim();
    const port = Number(portStr);
    if (!Number.isFinite(port) || port <= 0) {
      console.error('Set PORT in .env (e.g., PORT=9000)');
      process.exitCode = 1;
      return;
    }
    startDashboardServer(port);
    console.log('Press Ctrl+C to stop');
  }
);

cli.demandCommand(1).strict().parse();
