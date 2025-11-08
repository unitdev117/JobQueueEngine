import { connectMongo } from "../db/mongo.js";
import { JobModel } from "../models/index.js";
import { executeCommand } from "../processors/executeCommand.js";
import { handleResult } from "../processors/retryOrDlq.js";
import {
  logJson,
  writeWorkersRuntime,
  readWorkersRuntime,
  setWorkersStopFlag,
} from "../utils/logger.js";

const PENDING_STATES = ["pending", "failed"];

export async function runWorkers(config, count) {
  await connectMongo(config.MONGODB_URI);
  const workerCount = Math.max(1, Number(count || config.CONCURRENCY));
  await writeWorkersRuntime({
    pid: process.pid,
    count: workerCount,
    started_at: new Date().toISOString(),
  });

  const shouldStop = makeStopWatcher();

  const workers = Array.from({ length: workerCount }).map((_, idx) =>
    workerLoop(idx, config, shouldStop)
  );
  await Promise.all(workers);
  await setWorkersStopFlag(true);
}

async function workerLoop(workerId, config, shouldStop) {
  const leaseMs = Math.max(config.JOB_TIMEOUT_MS, 1000);
  let idleLoops = 0;

  while (true) {
    if (await shouldStop()) break;
    await requeueStaleLeases();

    const job = await claimNextJob(workerId, leaseMs);
    if (!job) {
      idleLoops++;
      if (idleLoops % 20 === 0) {
        console.log(`[worker ${workerId}] no jobs yet...`);
      }
      await sleep(250);
      continue;
    }

    idleLoops = 0;
    console.log(
      `[worker ${workerId}] started job ${job.id} (attempt ${job.attempts})`
    );
    logJson({
      at: new Date().toISOString(),
      jobId: job.id,
      workerId,
      state: "processing",
      attempt: job.attempts,
    });

    const result = await executeCommand(job.command, config.JOB_TIMEOUT_MS);
    const updated = handleResult(config, job, result);
    await persistJobUpdate(job.id, updated);

    if (updated.state === "completed") {
      console.log(
        `[worker ${workerId}] completed job ${job.id} (code ${updated.exit_code})`
      );
      logJson({
        at: new Date().toISOString(),
        jobId: job.id,
        workerId,
        state: "completed",
      });
    } else if (updated.state === "dead") {
      console.log(
        `[worker ${workerId}] job ${job.id} moved to DLQ after ${updated.attempts} attempts (code ${updated.exit_code})`
      );
      logJson({
        at: new Date().toISOString(),
        jobId: job.id,
        workerId,
        state: "dead",
        attempts: updated.attempts,
      });
    } else {
      console.log(
        `[worker ${workerId}] job ${job.id} failed but will retry (attempt ${updated.attempts}) at ${updated.next_run_at}`
      );
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

async function requeueStaleLeases() {
  const nowIso = new Date().toISOString();
  await JobModel.updateMany(
    {
      state: "processing",
      $or: [
        { "lease.lease_until": { $exists: false } },
        { "lease.lease_until": { $lt: nowIso } },
      ],
    },
    {
      $set: { state: "pending", updated_at: nowIso },
      $unset: { lease: "" },
    }
  );
}

async function claimNextJob(workerId, leaseMs) {
  const nowIso = new Date().toISOString();
  const nextDoc = await JobModel.findOneAndUpdate(
    {
      state: { $in: PENDING_STATES },
      $or: [
        { next_run_at: { $exists: false } },
        { next_run_at: null },
        { next_run_at: { $lte: nowIso } },
      ],
    },
    {
      $set: {
        state: "processing",
        lease: {
          workerId: `w${workerId}`,
          lease_until: new Date(Date.now() + leaseMs).toISOString(),
        },
        updated_at: nowIso,
      },
    },
    {
      sort: { created_at: 1, id: 1 },
      returnDocument: "after",
    }
  );
  return nextDoc ? nextDoc.toObject() : null;
}

async function persistJobUpdate(jobId, updated) {
  const payload = { ...updated };
  delete payload._id;
  const set = {};
  const unset = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      unset[key] = "";
    } else {
      set[key] = value;
    }
  }
  const updateOps = {};
  if (Object.keys(set).length) updateOps.$set = set;
  if (Object.keys(unset).length) updateOps.$unset = unset;
  if (!Object.keys(updateOps).length) return;
  await JobModel.updateOne({ id: jobId }, updateOps);
}

function makeStopWatcher() {
  let shouldStop = false;
  let nextCheck = 0;
  return async function checkStop() {
    if (shouldStop) return true;
    const now = Date.now();
    if (now < nextCheck) return false;
    nextCheck = now + 500;
    const info = await readWorkersRuntime();
    if (info && info.stopRequested) {
      shouldStop = true;
      return true;
    }
    return false;
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
