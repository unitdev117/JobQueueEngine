import fs from "node:fs";
import { queuePaths, jobFilePath } from "../queues/index.js";
import { readJson, writeJsonAtomic, moveFile } from "../utils/fsAtomic.js";
import { logJson } from "../utils/logger.js";

// Shows the list of files sitting in the dead letter queue.
export function dlqListController(config) {
  const p = queuePaths(config);
  if (!fs.existsSync(p.dlq)) return [];
  // return clean ids without .json so CLI looks nicer
  const ids = fs
    .readdirSync(p.dlq)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/i, ""));
  try { logJson({ at: new Date().toISOString(), type: 'command', cmd: 'dlq_list', count: ids.length }); } catch {}
  return ids;
}

// Takes a job out of DLQ and puts it back into the main queue.
// I also reset attempts because we want a fresh start here.
export function dlqRetryController(config, jobId) {
  const src = jobFilePath(config, "dlq", jobId);
  if (!fs.existsSync(src)) throw new Error(`Job ${jobId} not in DLQ`);
  const job = readJson(src);
  job.state = "pending";
  job.attempts = 0; // documented behavior
  job.updated_at = new Date().toISOString();
  delete job.exit_code;
  delete job.error;
  delete job.next_run_at;
  const dest = jobFilePath(config, "queue", jobId);
  writeJsonAtomic(dest, job);
  fs.unlinkSync(src);
  try { logJson({ at: new Date().toISOString(), type: 'command', cmd: 'dlq_retry', jobId }); } catch {}
  return { id: jobId, state: "pending" };
}
