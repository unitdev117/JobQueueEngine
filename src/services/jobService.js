import { connectMongo } from "../db/mongo.js";
import { JobModel } from "../models/index.js";
import { newId } from "../utils/id.js";
import { now } from "../utils/time.js";

const VALID_STATES = ["pending", "failed", "processing", "completed", "dead"];

async function ensureConnection(config) {
  await connectMongo(config?.MONGODB_URI || process.env.MONGODB_URI);
}

export async function createJob(config, data) {
  await ensureConnection(config);
  const id = data.id || newId();
  const exists = await JobModel.findOne({ id }).lean().exec();
  if (exists) {
    const err = new Error(`Job already exists: ${id}`);
    err.code = "EJOB_EXISTS";
    throw err;
  }
  const timestamp = now();
  const job = await JobModel.create({
    id,
    command: data.command,
    state: "pending",
    attempts: 0,
    max_retries: data.max_retries ?? config.MAX_RETRIES,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return job.toObject();
}

export async function countByState(config) {
  await ensureConnection(config);
  const counts = {
    pending: 0,
    failed: 0,
    processing: 0,
    completed: 0,
    dead: 0,
  };
  const rows = await JobModel.aggregate([
    { $group: { _id: "$state", count: { $sum: 1 } } },
  ]);
  for (const row of rows) {
    if (row && typeof row._id === "string" && counts.hasOwnProperty(row._id)) {
      counts[row._id] = row.count;
    }
  }
  return counts;
}

export async function findJobAny(config, id) {
  await ensureConnection(config);
  return JobModel.findOne({ id }).lean().exec();
}

export async function sanitizeQueueStates(config) {
  await ensureConnection(config);
  const timestamp = now();
  await JobModel.updateMany(
    { state: { $nin: VALID_STATES } },
    { $set: { state: "pending", updated_at: timestamp }, $unset: { lease: "" } }
  );
}

export async function listJobIdsByState(config, state) {
  await ensureConnection(config);
  if (!VALID_STATES.includes(state)) return [];
  const docs = await JobModel.find({ state }, { id: 1 })
    .sort({ created_at: 1, id: 1 })
    .lean()
    .exec();
  return docs.map((doc) => doc.id);
}

export async function countProcessingWorkers(config) {
  await ensureConnection(config);
  const workers = await JobModel.distinct("lease.workerId", {
    state: "processing",
    "lease.workerId": { $exists: true, $ne: null },
  });
  return workers.filter(Boolean).length;
}

export async function resetJobToPending(config, jobId, overrides = {}) {
  await ensureConnection(config);
  const payload = {
    state: "pending",
    attempts: overrides.attempts ?? 0,
    updated_at: now(),
    next_run_at: undefined,
    exit_code: undefined,
    error: undefined,
    stdout_tail: undefined,
    stderr_tail: undefined,
    lease: undefined,
  };
  await JobModel.updateOne(
    { id: jobId },
    {
      $set: {
        ...payload,
        ...overrides,
      },
      $unset: {
        next_run_at: "",
        exit_code: "",
        error: "",
        stdout_tail: "",
        stderr_tail: "",
        lease: "",
      },
    }
  );
}
