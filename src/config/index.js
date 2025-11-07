import path from "node:path";
import dotenv from "dotenv";

// Load .env using dotenv's default resolution (it walks upward from process.cwd()).
dotenv.config();

// Builds the runtime config from env + CLI flags (CLI wins).
// I put small defaults here to keep it running even if .env is empty.
export function loadConfig(cliOverrides = {}) {
  const env = process.env;
  const base = {
    QUEUE_ROOT: env.QUEUE_ROOT || "./data",
    LOG_DIR: env.LOG_DIR || "./logs",
    CONCURRENCY: toInt(env.CONCURRENCY, 3),
    MAX_RETRIES: toInt(env.MAX_RETRIES, 3),
    BACKOFF_BASE: toInt(env.BACKOFF_BASE, 2),
    MAX_BACKOFF_SEC: toInt(env.MAX_BACKOFF_SEC, 60),
    JOB_TIMEOUT_MS: toInt(env.JOB_TIMEOUT_MS, 30000),
    MONGODB_URI: env.MONGODB_URI || "mongodb://127.0.0.1:27017/queuectl",
  };
  const merged = { ...base, ...cliOverrides };
  return {
    ...merged,
    QUEUE_ROOT: path.resolve(process.cwd(), merged.QUEUE_ROOT),
    LOG_DIR: path.resolve(process.cwd(), merged.LOG_DIR),
    CONCURRENCY: toInt(merged.CONCURRENCY, base.CONCURRENCY),
    MAX_RETRIES: toInt(merged.MAX_RETRIES, base.MAX_RETRIES),
    BACKOFF_BASE: toInt(merged.BACKOFF_BASE, base.BACKOFF_BASE),
    MAX_BACKOFF_SEC: toInt(merged.MAX_BACKOFF_SEC, base.MAX_BACKOFF_SEC),
    JOB_TIMEOUT_MS: toInt(merged.JOB_TIMEOUT_MS, base.JOB_TIMEOUT_MS),
    MONGODB_URI: merged.MONGODB_URI || base.MONGODB_URI,
  };
}

function toInt(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
