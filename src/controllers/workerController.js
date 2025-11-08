import path from "node:path";
import { runWorkers } from "../services/workerService.js";
import { sanitizeQueueStates } from "../services/jobService.js";
import {
  initLogger,
  readWorkersRuntime,
  logJson,
  setWorkersStopFlag,
} from "../utils/logger.js";
import { spawn } from "node:child_process";

// Starts the worker loops. It just awaits them (they run until stop flag exists).
export async function workerStartController(config, count, opts = {}) {
  initLogger(config.MONGODB_URI);
  const howMany = Number(count || config.CONCURRENCY) || 1;
  await setWorkersStopFlag(false);
  console.log(`Starting ${howMany} worker(s) using MongoDB persistence`);
  try {
    logJson({
      at: new Date().toISOString(),
      type: "command",
      cmd: "worker_start",
      count: howMany,
      detach: !!opts.detach,
    });
  } catch {}
  if (opts.detach) {
    const entry = path.resolve(process.cwd(), "index.js");
    const child = spawn(
      process.execPath,
      [entry, "worker", "start", "--count", String(howMany)],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
    return;
  }
  // Repair any inconsistent queue states before starting
  try {
    await sanitizeQueueStates(config);
  } catch {}
  await runWorkers(config, howMany);
}

// Writes a small STOP file that workers check to shutdown gracefully.
export async function workerStopController(config) {
  initLogger(config.MONGODB_URI);
  await setWorkersStopFlag(true);
  try {
    logJson({
      at: new Date().toISOString(),
      type: "command",
      cmd: "worker_stop",
    });
  } catch {}
  return { message: "Stop signal recorded. Workers will exit soon." };
}

// Reads the worker runtime info for status command.
export async function workersInfoController(config) {
  initLogger(config.MONGODB_URI);
  const info = await readWorkersRuntime();
  if (!info || !info.pid) return { running: false };
  if (info.stopRequested) return { running: false };
  // Verify pid exists to avoid stale status
  try {
    process.kill(info.pid, 0);
    return info;
  } catch {
    return { running: false };
  }
}
