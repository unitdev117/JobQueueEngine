import path from 'node:path';
import fs from 'node:fs';
import { ensureDir } from '../utils/fsAtomic.js';

// Makes and returns the main queue folders we use.
export function queuePaths(config) {
  const root = config.QUEUE_ROOT;
  const dirs = {
    queue: path.join(root, 'queue'),
    processing: path.join(root, 'processing'),
    dlq: path.join(root, 'dlq'),
    archive: path.join(root, 'archive'),
  };
  Object.values(dirs).forEach(ensureDir);
  return dirs;
}

// Just builds the path to a job JSON based on its folder and id.
export function jobFilePath(config, dir, id) {
  return path.join(queuePaths(config)[dir], `${id}.json`);
}

// Lists job file names (like 123.json) for a folder.
export function listJobs(config, dir) {
  const d = queuePaths(config)[dir];
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json'));
}
