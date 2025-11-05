import { fromNowIso } from '../utils/time.js';

// When a worker picks up a job, we attach a "lease" to it so others skip it.
export function withNewLease(job, workerId, ms) {
  return {
    ...job,
    lease: { workerId, lease_until: fromNowIso(ms) },
    state: 'processing',
    updated_at: new Date().toISOString(),
  };
}

// If the lease time passed (like worker crashed), we consider it stale.
export function isLeaseStale(job) {
  if (!job.lease || !job.lease.lease_until) return true;
  return Date.now() > Date.parse(job.lease.lease_until);
}
