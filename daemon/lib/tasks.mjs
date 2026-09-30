// The task queue: every prompt run and text extraction, running, finished (with the note
// it made) or failed. One JSON file per task in ~/.local/state/oma-zotero/tasks/, plus an
// index (tasks.json, newest first) rewritten on every change for the launcher to watch.
// A task whose process is gone while "running" is reported as stopped. Pure but for the
// file I/O (node-tested).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const KEEP = 50; // finished tasks kept

export function tasksDir(env = process.env) {
  return join(env.XDG_STATE_HOME || join(env.HOME || "", ".local", "state"), "oma-zotero", "tasks");
}

function write(path, obj) {
  writeFileSync(path + ".tmp", JSON.stringify(obj));
  renameSync(path + ".tmp", path);
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// Every task, newest first; a "running" one whose process is gone becomes an error.
export function listTasks(dir = tasksDir(), isAlive = alive) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!/^[\w-]+\.json$/.test(f) || f === "tasks.json") continue;
    try {
      const t = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (t.status === "running" && !isAlive(t.pid)) {
        Object.assign(t, { status: "error", error: "stopped before it finished", finished: t.finished || new Date().toISOString() });
        write(join(dir, f), t);
      }
      out.push(t);
    } catch { /* half-written: next time */ }
  }
  // Newest first; same-millisecond starts by id, so the order is stable.
  return out.sort((a, b) => (a.started < b.started ? 1 : a.started > b.started ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

// Rewrite the index the launcher watches; drop finished tasks beyond KEEP.
export function writeIndex(dir = tasksDir(), isAlive = alive) {
  mkdirSync(dir, { recursive: true });
  const all = listTasks(dir, isAlive);
  let kept = 0;
  const shown = [];
  for (const t of all) {
    if (t.status !== "running" && ++kept > KEEP) {
      try { unlinkSync(join(dir, t.id + ".json")); } catch { /* gone */ }
      continue;
    }
    shown.push(t);
  }
  write(join(dir, "tasks.json"), { updated: new Date().toISOString(), tasks: shown });
  return shown;
}

// → the task, recorded as running.
export function startTask(fields, dir = tasksDir()) {
  mkdirSync(dir, { recursive: true });
  const task = Object.assign({ id: new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomBytes(3).toString("hex"), status: "running", started: new Date().toISOString(), pid: process.pid }, fields);
  write(join(dir, task.id + ".json"), task);
  writeIndex(dir);
  return task;
}

// What a running task learned since it started (its paper, its model): shown while it runs.
export function updateTask(task, fields, dir = tasksDir()) {
  Object.assign(task, fields);
  write(join(dir, task.id + ".json"), task);
  writeIndex(dir);
  return task;
}

export function finishTask(task, fields, dir = tasksDir()) {
  Object.assign(task, { status: "done", finished: new Date().toISOString() }, fields);
  write(join(dir, task.id + ".json"), task);
  writeIndex(dir);
  return task;
}

export function failTask(task, error, dir = tasksDir()) {
  Object.assign(task, { status: "error", finished: new Date().toISOString(), error: String(error || "failed") });
  write(join(dir, task.id + ".json"), task);
  writeIndex(dir);
  return task;
}

// Forget finished and failed tasks (running ones stay).
export function clearTasks(dir = tasksDir()) {
  for (const t of listTasks(dir)) if (t.status !== "running") try { unlinkSync(join(dir, t.id + ".json")); } catch { /* gone */ }
  return writeIndex(dir);
}
