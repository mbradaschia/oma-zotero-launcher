// What the runner does differently on macOS: notifications, opening a file or an editor, where
// command-line tools live (Homebrew), and the install hint for a missing one. Linux (Omarchy)
// keeps its own commands; everything takes the platform so tests can pick one.
import { spawn } from "node:child_process";
import { join } from "node:path";

export const isMac = (platform = process.platform) => platform === "darwin";

// The directories macOS apps don't put on PATH: a process started from the Dock or another app
// gets /usr/bin:/bin:/usr/sbin:/sbin, without Homebrew (pdftotext, ollama, node) or the CLIs
// installed per user (claude, codex). Returns PATH with them added at the end, once.
export function toolPath(env = process.env, platform = process.platform) {
  const path = env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin";
  if (!isMac(platform)) return path;
  const have = new Set(path.split(":"));
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", env.HOME && join(env.HOME, ".local", "bin")].filter((d) => d && !have.has(d));
  return extra.length ? path + ":" + extra.join(":") : path;
}

// How to install a missing package: Homebrew on macOS, Omarchy's package command elsewhere.
export function installHint(pkg, platform = process.platform) {
  return isMac(platform) ? `brew install ${pkg}` : `omarchy pkg add ${pkg}`;
}

function detached(cmd, args, run) {
  const child = run(cmd, args, { stdio: "ignore", detached: true });
  child.unref();
  return child;
}

// A desktop notification. The text goes to osascript as arguments, never into the script.
export function notify(summary, body = "", urgency = "normal", { platform = process.platform, run = spawn } = {}) {
  try {
    if (isMac(platform)) {
      const script = ["on run argv", "display notification (item 2 of argv) with title (item 1 of argv)", "end run"];
      detached("osascript", [...script.flatMap((l) => ["-e", l]), String(summary), String(body)], run).on("error", () => {});
    } else {
      detached("notify-send", ["-a", "Zotero", "-u", urgency, String(summary), String(body)], run).on("error", () => {});
    }
  } catch { /* no notifier */ }
}

// Open a text file in the user's editor: TextEdit or whatever handles text on macOS;
// omarchy-launch-editor (a terminal editor in a new window), else xdg-open, elsewhere.
export function openInEditor(path, { platform = process.platform, run = spawn } = {}) {
  if (isMac(platform)) return void detached("open", ["-t", path], run).on("error", () => {});
  detached("omarchy-launch-editor", [path], run).on("error", () => detached("xdg-open", [path], run).on("error", () => {}));
}
