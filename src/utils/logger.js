import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './fsAtomic.js';

let logDir = null;

// Set up where logs go. I just store the folder path.
export function initLogger(dir) {
  logDir = dir;
  ensureDir(logDir);
}

// Writes one JSON log line per event. Pretty basic logger.
export function logJson(event) {
  if (!logDir) return;
  const file = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
}

// This stores some info about running workers (pid and count) so status can read it.
export function writeWorkersRuntime(info) {
  if (!logDir) return;
  const file = path.join(logDir, `workers.json`);
  fs.writeFileSync(file, JSON.stringify(info, null, 2));
}

// Reads the workers runtime info back from disk.
export function readWorkersRuntime() {
  if (!logDir) return null;
  const file = path.join(logDir, `workers.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
