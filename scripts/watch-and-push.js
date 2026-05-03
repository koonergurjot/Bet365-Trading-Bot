#!/usr/bin/env node
/**
 * watch-and-push.js
 * Watches the project for file changes, then auto-commits and pushes to GitHub.
 * Run with: npm run watch
 *
 * - Debounces 4 seconds after the last change before committing
 * - Skips .git, node_modules, and OS temp files
 * - Commit message includes a timestamp and list of changed files
 */

import { watch } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, relative } from "node:path";

const ROOT        = resolve(new URL(".", import.meta.url).pathname, "..");
const DEBOUNCE_MS = 4000;

const IGNORE = [
  ".git", "node_modules", ".DS_Store", "Thumbs.db",
  "desktop.ini", ".env", ".env.local"
];

function shouldIgnore(filename) {
  if (!filename) return true;
  return IGNORE.some((pat) => filename.includes(pat));
}

function git(cmd, opts = {}) {
  return execSync(`git -C "${ROOT}" ${cmd}`, {
    encoding: "utf8",
    stdio: opts.silent ? "pipe" : "inherit",
    ...opts,
  });
}

function hasChanges() {
  try {
    const status = git("status --porcelain", { silent: true });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

function changedFiles() {
  try {
    const status = git("status --porcelain", { silent: true });
    return status
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .slice(0, 5); // cap at 5 for commit message
  } catch {
    return [];
  }
}

function pushChanges(files) {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const summary   = files.length > 0 ? files.join(", ") : "misc changes";
  const msg       = `auto: ${timestamp} — ${summary}`;

  try {
    git("add .");
    git(`commit -m "${msg}"`);
    git("push origin main");
    console.log(`\n✅ [${timestamp}] Pushed: ${summary}`);
  } catch (err) {
    console.error(`\n❌ Push failed: ${err.message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────
let debounceTimer = null;
let pendingFiles  = new Set();

console.log("👁  Watching for changes in:", ROOT);
console.log("    Auto-push fires", DEBOUNCE_MS / 1000, "seconds after last save\n");

watch(ROOT, { recursive: true }, (eventType, filename) => {
  if (shouldIgnore(filename)) return;

  const rel = filename ? relative(ROOT, resolve(ROOT, filename)) : "unknown";
  process.stdout.write(`  ~ ${rel}\n`);
  pendingFiles.add(rel);

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (!hasChanges()) {
      console.log("  (no git changes detected, skipping push)");
      pendingFiles.clear();
      return;
    }
    const files = changedFiles();
    pendingFiles.clear();
    pushChanges(files);
  }, DEBOUNCE_MS);
});

// Keep process alive
process.on("SIGINT",  () => { console.log("\nWatcher stopped."); process.exit(0); });
process.on("SIGTERM", () => { console.log("\nWatcher stopped."); process.exit(0); });
