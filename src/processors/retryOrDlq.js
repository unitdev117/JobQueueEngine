import { nextDelaySeconds } from '../services/backoffService.js';
import { fromNowIso, now } from '../utils/time.js';

// Decides what to do with a job after it runs: complete, retry, or DLQ.
export function handleResult(config, job, result) {
  const base = config.BACKOFF_BASE;
  const cap = config.MAX_BACKOFF_SEC;
  if (result.code === 200 || result.code === 0) {
    return {
      ...job,
      state: 'completed',
      exit_code: result.code,
      stdout_tail: result.stdout,
      stderr_tail: result.stderr,
      updated_at: now(),
      lease: undefined,
    };
  }
  const attempts = (job.attempts || 0) + 1;
  if (attempts > job.max_retries) {
    return {
      ...job,
      state: 'dead',
      attempts,
      exit_code: result.code,
      error: result.error,
      stdout_tail: result.stdout,
      stderr_tail: result.stderr,
      updated_at: now(),
      lease: undefined,
    };
  }
  const delaySec = nextDelaySeconds({ base, attempt: attempts, maxCap: cap });
  return {
    ...job,
    state: 'failed',
    attempts,
    next_run_at: fromNowIso(delaySec * 1000),
    exit_code: result.code,
    error: result.error,
    stdout_tail: result.stdout,
    stderr_tail: result.stderr,
    updated_at: now(),
    lease: undefined,
  };
}
