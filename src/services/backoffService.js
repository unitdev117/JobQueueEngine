// This calculates how long to wait before retrying a job.
// It's basically base^attempt but we also cap it so it doesn't grow forever.
export function nextDelaySeconds({ base, attempt, maxCap }) {
  const raw = Math.pow(base, attempt);
  return Math.min(raw, maxCap);
}
