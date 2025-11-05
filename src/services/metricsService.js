// Just keeping some basic counters in memory.
let counters = {
  processed: 0,
  succeeded: 0,
  retried: 0,
  dead: 0,
};

// Increase one metric (like processed by 1).
export function inc(key) { counters[key] = (counters[key] || 0) + 1; }
// Returns a copy of counters so it's safe to read.
export function snapshot() { return { ...counters }; }
