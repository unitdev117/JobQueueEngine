import { createJob, countByState, findJobAny } from "../services/jobService.js";
import { readJson } from "../utils/fsAtomic.js";
import { logJson } from "../utils/logger.js";

// Takes a JSON string, makes a job, and puts it into the queue.
export function enqueueController(config, jobJson) {
  let data;
  try {
    data = JSON.parse(jobJson);
  } catch (e) {
    throw new Error("Invalid JSON for job");
  }
  // Accept either an array or a shell-like string and normalize to [cmd, ...args]
  if (typeof data.command === 'string') {
    const parts = splitCommandString(data.command);
    if (parts.length === 0) throw new Error("Job.command string is empty");
    // Windows compatibility for 'sleep N'
    if (process.platform === 'win32' && parts[0].toLowerCase() === 'sleep') {
      const sec = Number(parts[1] || 1);
      data.command = [
        'powershell',
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `Start-Sleep -Seconds ${Math.max(0, Math.floor(sec))}`,
      ];
    } else {
      data.command = parts;
    }
  }
  if (!Array.isArray(data.command))
    throw new Error("Job.command must be an array or string");
  const job = createJob(config, data);
  try {
    logJson({ at: new Date().toISOString(), type: 'command', cmd: 'enqueue', jobId: job.id, command: job.command });
  } catch {}
  return job;
}

// Shows basic status (config snapshot and counts by state).
export function statusController(config) {
  const result = {
    config: { ...config, QUEUE_ROOT: config.QUEUE_ROOT, LOG_DIR: config.LOG_DIR },
    counts: countByState(config),
  };
  try {
    logJson({ at: new Date().toISOString(), type: 'command', cmd: 'status', counts: result.counts });
  } catch {}
  return result;
}

// Splits a shell-like command string into argv respecting quotes
function splitCommandString(s) {
  const out = [];
  let buf = '';
  let quote = null; // ' or "
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && i + 1 < s.length && s[i + 1] === quote) {
        buf += quote; i++; // escaped quote
      } else {
        buf += ch;
      }
    } else {
      if (ch === '"' || ch === '\'') {
        quote = ch;
      } else if (/\s/.test(ch)) {
        if (buf) { out.push(buf); buf = ''; }
      } else {
        buf += ch;
      }
    }
  }
  if (buf) out.push(buf);
  return out;
}

// Loads a job by id from any state directory and returns details
export function showJobController(config, id) {
  const file = findJobAny(config, id);
  if (!file) {
    try { logJson({ at: new Date().toISOString(), type: 'command', cmd: 'job_show', jobId: id, found: false }); } catch {}
    return { found: false, id };
  }
  try {
    const job = readJson(file);
    try { logJson({ at: new Date().toISOString(), type: 'command', cmd: 'job_show', jobId: id, found: true }); } catch {}
    return { found: true, id, file, job };
  } catch {
    try { logJson({ at: new Date().toISOString(), type: 'command', cmd: 'job_show', jobId: id, found: false }); } catch {}
    return { found: false, id };
  }
}
