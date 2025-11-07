import {
  listJobIdsByState,
  resetJobToPending,
  findJobAny,
} from "../services/jobService.js";
import { logJson } from "../utils/logger.js";

// Shows the list of files sitting in the dead letter queue.
export async function dlqListController(config) {
  const ids = await listJobIdsByState(config, "dead");
  try {
    logJson({
      at: new Date().toISOString(),
      type: "command",
      cmd: "dlq_list",
      count: ids.length,
    });
  } catch {}
  return ids;
}

// Takes a job out of DLQ and puts it back into the main queue.
// I also reset attempts because we want a fresh start here.
export async function dlqRetryController(config, jobId) {
  const job = await findJobAny(config, jobId);
  if (!job || job.state !== "dead") throw new Error(`Job ${jobId} not in DLQ`);
  await resetJobToPending(config, jobId, { attempts: 0 });
  try {
    logJson({
      at: new Date().toISOString(),
      type: "command",
      cmd: "dlq_retry",
      jobId,
    });
  } catch {}
  return { id: jobId, state: "pending" };
}
