import {
  createJob,
  countByState,
  findJobAny,
  sanitizeQueueStates,
} from "../services/jobService.js";
import { logJson } from "../utils/logger.js";

// Takes a JSON string, makes a job, and puts it into the queue.
export async function enqueueController(config, jobJson) {
  let data;
  try {
    data = JSON.parse(jobJson);
  } catch (e) {
    throw new Error("Invalid JSON for job");
  }
  // Accept either an array or a shell-like string and normalize to [cmd, ...args]
  if (typeof data.command === "string") {
    const parts = splitCommandString(data.command);
    if (parts.length === 0) throw new Error("Job.command string is empty");
    data.command = parts;
  }
  if (!Array.isArray(data.command))
    throw new Error("Job.command must be an array or string");
  const job = await createJob(config, data);
  try {
    logJson({
      at: new Date().toISOString(),
      type: "command",
      cmd: "enqueue",
      jobId: job.id,
      command: job.command,
    });
  } catch {}
  return job;
}

// Shows basic status (config snapshot and counts by state).
export async function statusController(config) {
  // Ensure queue invariants before reporting
  try {
    await sanitizeQueueStates(config);
  } catch {}
  const result = {
    config: {
      ...config,
      QUEUE_ROOT: config.QUEUE_ROOT,
      LOG_DIR: config.LOG_DIR,
    },
    counts: await countByState(config),
  };
  try {
    logJson({
      at: new Date().toISOString(),
      type: "command",
      cmd: "status",
      counts: result.counts,
    });
  } catch {}
  return result;
}

// Splits a shell-like command string into argv respecting quotes
function splitCommandString(s) {
  const out = [];
  let buf = "";
  let quote = null; // ' or "
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && i + 1 < s.length && s[i + 1] === quote) {
        buf += quote;
        i++; // escaped quote
      } else {
        buf += ch;
      }
    } else {
      if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (/\s/.test(ch)) {
        if (buf) {
          out.push(buf);
          buf = "";
        }
      } else {
        buf += ch;
      }
    }
  }
  if (buf) out.push(buf);
  return out;
}

// Loads a job by id from any state directory and returns details
export async function showJobController(config, id) {
  const job = await findJobAny(config, id);
  if (!job) {
    try {
      logJson({
        at: new Date().toISOString(),
        type: "command",
        cmd: "job_show",
        jobId: id,
        found: false,
      });
    } catch {}
    return { found: false, id };
  }
  try {
    logJson({
      at: new Date().toISOString(),
      type: "command",
      cmd: "job_show",
      jobId: id,
      found: true,
    });
  } catch {}
  return { found: true, id, location: `mongodb:jobs/${id}`, job };
}
