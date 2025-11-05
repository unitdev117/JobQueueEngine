import path from "node:path";
import fs from "node:fs";
import { queuePaths, listJobs, jobFilePath } from "../queues/index.js";
import { readJson, writeJsonAtomic, moveFile, listJsonFiles } from "../utils/fsAtomic.js";
import { withNewLease, isLeaseStale } from "./lockService.js";
import { executeCommand } from "../processors/executeCommand.js";
import { handleResult } from "../processors/retryOrDlq.js";
import { initLogger, logJson, writeWorkersRuntime } from "../utils/logger.js";

// This spins up N worker loops that keep picking jobs and running them.
export async function runWorkers(config, count) {
  initLogger(config.LOG_DIR);
  const p = queuePaths(config);
  const workerCount = Math.max(1, Number(count || config.CONCURRENCY));
  const stopFlag = path.join(config.LOG_DIR, "STOP");
  writeWorkersRuntime({
    pid: process.pid,
    count: workerCount,
    started_at: new Date().toISOString(),
  });

  const workers = new Array(workerCount).fill(0).map((_, i) => loop(i));
  await Promise.all(workers);

  async function loop(workerId) {
    let idleLoops = 0;
    while (true) {
      if (fs.existsSync(stopFlag)) break;
      // Re-queue stale leases
      requeueStale(p.processing, p.queue);

      const jobPath = pickNextJob(p.queue);
      if (!jobPath) {
        idleLoops++;
        if (idleLoops % 20 === 0) {
          console.log(`[worker ${workerId}] no jobs yet...`);
        }
        await sleep(250);
        continue;
      }
      idleLoops = 0;
      let job = readJson(jobPath);
      // respect next_run_at
      if (job.next_run_at && Date.now() < Date.parse(job.next_run_at)) {
        await sleep(200);
        continue;
      }
      // only process jobs that are pending or failed (retryable)
      if (job.state && !['pending', 'failed'].includes(job.state)) {
        await sleep(50);
        continue;
      }
      // claim by moving to processing and writing lease so others don't take it
      const processingPath = jobFilePath(config, "processing", job.id);
      try {
        moveFile(jobPath, processingPath);
      } catch {
        // lost race
        continue;
      }
      job = withNewLease(
        readJson(processingPath),
        `w${workerId}`,
        Math.max(config.JOB_TIMEOUT_MS, 1000)
      );
      writeJsonAtomic(processingPath, job);
      if (job.lease && job.lease.lease_until) {
        console.log(`[worker ${workerId}] leased job ${job.id} until ${job.lease.lease_until}`);
      }
      console.log(`[worker ${workerId}] started job ${job.id} (attempt ${job.attempts})`);
      logJson({
        at: new Date().toISOString(),
        jobId: job.id,
        workerId,
        state: "processing",
        attempt: job.attempts,
      });
      const result = await executeCommand(job.command, config.JOB_TIMEOUT_MS);
      const updated = handleResult(config, job, result);
      if (updated.state === "completed") {
        const dest = jobFilePath(config, "archive", job.id);
        writeJsonAtomic(dest, updated);
        try {
          fs.unlinkSync(processingPath);
        } catch {}
        console.log(`[worker ${workerId}] completed job ${job.id} (code ${updated.exit_code})`);
        logJson({
          at: new Date().toISOString(),
          jobId: job.id,
          workerId,
          state: "completed",
        });
      } else if (updated.state === "dead") {
        const dest = jobFilePath(config, "dlq", job.id);
        writeJsonAtomic(dest, updated);
        try {
          fs.unlinkSync(processingPath);
        } catch {}
        console.log(`[worker ${workerId}] job ${job.id} moved to DLQ after ${updated.attempts} attempts (code ${updated.exit_code})`);
        logJson({
          at: new Date().toISOString(),
          jobId: job.id,
          workerId,
          state: "dead",
          attempts: updated.attempts,
        });
      } else {
        // pending retry -> move back to queue
        const dest = jobFilePath(config, "queue", job.id);
        writeJsonAtomic(dest, updated);
        try {
          fs.unlinkSync(processingPath);
        } catch {}
        console.log(`[worker ${workerId}] job ${job.id} failed but will retry (attempt ${updated.attempts}) at ${updated.next_run_at}`);
        logJson({
          at: new Date().toISOString(),
          jobId: job.id,
          workerId,
          state: "retry",
          attempts: updated.attempts,
          next_run_at: updated.next_run_at,
        });
      }
    }
  }
}

// Goes through processing jobs and if lease expired, moves them back to queue.
function requeueStale(processingDir, queueDir) {
  for (const f of listJsonFiles(processingDir)) {
    try {
      const job = readJson(f);
      if (isLeaseStale(job)) {
        const name = path.basename(f);
        const dest = path.join(queueDir, name);
        // normalize job state back to pending and drop lease when returning to queue
        const normalized = { ...job, state: 'pending', lease: undefined, updated_at: new Date().toISOString() };
        writeJsonAtomic(f, normalized);
        moveFile(f, dest);
        console.log(`[requeue] moved stale leased job ${job.id} back to queue`);
      }
    } catch {}
  }
}

// Picks the next job in a simple way (sorted filenames = kinda FIFO).
function pickNextJob(queueDir) {
  const files = listJsonFiles(queueDir);
  files.sort();
  const nowTs = Date.now();
  for (const f of files) {
    try {
      const j = readJson(f);
      const state = j.state || 'pending';
      if (!['pending', 'failed'].includes(state)) continue;
      if (j.next_run_at && nowTs < Date.parse(j.next_run_at)) continue;
      return f;
    } catch {}
  }
  return null;
}

// cheap sleep helper so the loop can relax if there's no work
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
