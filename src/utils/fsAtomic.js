import fs from 'node:fs';
import path from 'node:path';

// Makes sure a folder exists. If not, it creates it (and parents too).
export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// Reads a JSON file and turns it into a JS object.
export function readJson(file) {
  const s = fs.readFileSync(file, 'utf8');
  return JSON.parse(s);
}

// Writes a JSON file in an "atomic" way using a temp file then rename.
// This helps avoid partial writes if the app crashes mid-write.
export function writeJsonAtomic(file, obj) {
  const dir = path.dirname(file);
  ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// Returns full paths of all .json files in a folder.
export function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f));
}

// Moves a file (used to shift jobs between folders).
export function moveFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.renameSync(src, dest);
}

// Just a tiny wrapper for checking if something exists.
export function exists(p) {
  return fs.existsSync(p);
}
