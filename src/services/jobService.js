import fs from "node:fs";
import path from "node:path";
import { queuePaths, jobFilePath } from "../queues/index.js";
import { writeJsonAtomic, readJson, moveFile, listJsonFiles } from "../utils/fsAtomic.js";
import { newId } from "../utils/id.js";
import { now } from "../utils/time.js";

// Makes a new job object and saves it into the queue folder.
export function createJob(config, data) {
  const id = data.id || newId();
  const job = {
    id,
    command: data.command,
    state: "pending",
    attempts: 0,
    max_retries: data.max_retries ?? config.MAX_RETRIES,
    created_at: now(),
    updated_at: now(),
  };
  const file = jobFilePath(config, "queue", id);
  writeJsonAtomic(file, job);
  return job;
}

// Just reads a job json file into memory.
export function loadJob(file) {
  return readJson(file);
}

// Saves a job back to disk (atomic write).
export function saveJob(file, job) {
  writeJsonAtomic(file, job);
}

// Puts a job into the archive folder (like marking completed).
export function archiveJob(config, id, job) {
  const src = findJobAny(config, id);
  const dest = jobFilePath(config, "archive", id);
  writeJsonAtomic(dest, job);
  if (src)
    try {
      fs.unlinkSync(src);
    } catch {}
}

// Moves a job from one folder to another and lets caller tweak its content.
export function moveToDir(config, id, from, to, mutate) {
  const src = jobFilePath(config, from, id);
  const dest = jobFilePath(config, to, id);
  const job = readJson(src);
  const next = mutate ? mutate(job) : job;
  writeJsonAtomic(src, next); // ensure content
  moveFile(src, dest);
  return next;
}

// Opens a job json, applies a function to change it, then saves it.
export function updateJobInPlace(file, mutate) {
  const job = readJson(file);
  const next = mutate(job);
  writeJsonAtomic(file, next);
  return next;
}

// Finds a job by id in any of the folders we use.
export function findJobAny(config, id) {
  const dirs = ["queue", "processing", "dlq", "archive"];
  for (const d of dirs) {
    const p = jobFilePath(config, d, id);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Counts how many jobs are in each state (based on folders).
export function countByState(config) {
  const p = queuePaths(config);
  // Split queue contents into pending vs failed based on job.state field
  let pending = 0;
  let failed = 0;
  for (const f of listJsonFiles(p.queue)) {
    try {
      const j = readJson(f);
      // Mirror list command semantics: only explicit 'pending' counts as pending
      if (j && j.state === 'failed') failed++;
      else if (j && j.state === 'pending') pending++;
      // Any other state lingering in queue (e.g., 'processing') is ignored in counts
    } catch {
      // Unreadable JSON: do not inflate counts; ignore for accuracy
    }
  }
  return {
    pending,
    failed,
    processing: listJsonFiles(p.processing).length,
    dead: listJsonFiles(p.dlq).length,
    completed: listJsonFiles(p.archive).length,
  };
}

// Ensures all jobs in queue/ have a valid queue state: 'pending' or 'failed'.
// If anything else is found (e.g., 'processing' due to a crash), normalize to 'pending'.
export function sanitizeQueueStates(config) {
  const p = queuePaths(config);
  for (const f of listJsonFiles(p.queue)) {
    try {
      const j = readJson(f);
      if (!j || (j.state === 'pending' || j.state === 'failed')) continue;
      const fixed = { ...j, state: 'pending', lease: undefined, updated_at: new Date().toISOString() };
      writeJsonAtomic(f, fixed);
    } catch {
      // ignore unreadable
    }
  }
}
