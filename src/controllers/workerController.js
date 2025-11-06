import fs from 'node:fs';
import path from 'node:path';
import { runWorkers } from '../services/workerService.js';
import { sanitizeQueueStates } from '../services/jobService.js';
import { initLogger, readWorkersRuntime, logJson } from '../utils/logger.js';
import { spawn, execSync } from 'node:child_process';

// Starts the worker loops. It just awaits them (they run until stop flag exists).
export async function workerStartController(config, count, opts = {}) {
  const howMany = Number(count || config.CONCURRENCY) || 1;
  // Clear STOP flag if present to allow workers to run
  try {
    const flag = path.join(config.LOG_DIR, 'STOP');
    if (fs.existsSync(flag)) fs.unlinkSync(flag);
  } catch {}
  console.log(`Starting ${howMany} worker(s) with QUEUE_ROOT=${config.QUEUE_ROOT}`);
  try { logJson({ at: new Date().toISOString(), type: 'command', cmd: 'worker_start', count: howMany, detach: !!opts.detach }); } catch {}
  if (opts.detach) {
    const entry = path.resolve(process.cwd(), 'index.js');
    const child = spawn(process.execPath, [entry, 'worker', 'start', '--count', String(howMany)], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  // Repair any inconsistent queue states before starting
  try { sanitizeQueueStates(config); } catch {}
  await runWorkers(config, howMany);
}

// Writes a small STOP file that workers check to shutdown gracefully.
export function workerStopController(config) {
  initLogger(config.LOG_DIR);
  const flag = path.join(config.LOG_DIR, 'STOP');
  fs.writeFileSync(flag, 'stop');
  try { logJson({ at: new Date().toISOString(), type: 'command', cmd: 'worker_stop' }); } catch {}
  return { message: 'Stop signal written. Workers will exit soon.' };
}

// Reads the worker runtime info for status command.
export function workersInfoController(config) {
  initLogger(config.LOG_DIR);
  const info = readWorkersRuntime();
  if (!info || !info.pid) return { running: false };
  // If STOP flag exists, consider not running/paused
  const stopFlag = path.join(config.LOG_DIR, 'STOP');
  if (fs.existsSync(stopFlag)) return { running: false };
  // Verify pid exists to avoid stale status
  try {
    if (process.platform === 'win32') {
      const out = execSync(`tasklist /FI "PID eq ${info.pid}"`, { stdio: ['ignore','pipe','ignore'] }).toString();
      if (out.includes(String(info.pid))) return info;
      return { running: false };
    } else {
      process.kill(info.pid, 0);
      return info;
    }
  } catch {
    return { running: false };
  }
}
