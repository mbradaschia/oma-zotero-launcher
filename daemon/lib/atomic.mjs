// Writes that never leave a half-written file, for the files a sync folder carries: a temporary
// file in the same folder, renamed over the old one. Refused while the sync folder is missing.
import { writeFileSync, renameSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { assertWritable } from "./paths.mjs";

export function ensureDir(dir, env = process.env) {
  assertWritable(dir, env);
  mkdirSync(dir, { recursive: true });
}

export function writeAtomic(path, text, env = process.env) {
  assertWritable(path, env);
  mkdirSync(dirname(path), { recursive: true });
  // a temporary name of its own: runs write at the same time (the rename is atomic, the last one wins)
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
