import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url),
  require = createRequire(import.meta.url);
const directories = 1536,
  perDirectory = 12,
  resolverMisses = 8192;
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const tenth = (x) => Math.round(x * 10) / 10;

function prepare(root) {
  for (const name of ["staging", "watched", "deps"])
    fs.mkdirSync(path.join(root, name));
  fs.writeFileSync(path.join(root, "watched", "seed.js"), "seed");
  fs.writeFileSync(path.join(root, "boundary"), "");
  for (let i = 0; i < directories; i++) {
    const dir = path.join(root, "staging", String(i));
    fs.mkdirSync(dir);
    for (let j = 0; j < perDirectory; j++)
      fs.writeFileSync(path.join(dir, j + ".js"), "");
  }
}
async function measure(binding, root, traced) {
  const { NativeWatcher } = require(path.resolve(binding));
  const watcher = new NativeWatcher({});
  const watched = path.join(root, "watched"),
    seed = path.join(watched, "seed.js"),
    moved = path.join(watched, "generated"),
    staging = path.join(root, "staging"),
    probe = path.join(root, "deps", "probe.js"),
    boundary = path.join(root, "boundary");
  const missing = Array.from({ length: resolverMisses }, (_, i) =>
    path.join(root, "deps", i + ".js"),
  );
  let failure,
    probeRemoved = false;
  const until = async (fn, label) => {
    const end = Date.now() + 15000;
    while (!fn()) {
      if (failure) throw failure;
      if (Date.now() > end) throw Error("Timeout waiting for " + label);
      await delay(5);
    }
  };
  const capture = (mark = false) => {
    if (failure) throw failure;
    if (mark) fs.closeSync(fs.openSync(boundary, "a"));
    const start = performance.now();
    const times = watcher.collectTimeInfoEntries();
    const elapsed = performance.now() - start;
    if (mark) fs.closeSync(fs.openSync(boundary, "a"));
    const prefix = moved + path.sep;
    const rows = times.fileTimestamps.entries.filter(
      (row) => row.path.startsWith(prefix) && typeof row.timestamp === "number",
    ).length;
    return { ms: tenth(elapsed), rows };
  };
  try {
    watcher.watch(
      [[probe], []],
      [[watched], []],
      [missing, []],
      BigInt(Date.now()),
      (e) => {
        if (e) failure = e;
      },
      (e) => {
        if (e.path === probe && e.kind === "remove") probeRemoved = true;
      },
    );
    await until(() => {
      const table = watcher.collectTimeInfoEntries().fileTimestamps;
      return (
        table.missing.length === resolverMisses &&
        table.entries.some((r) => r.path === seed && r.timestamp != null)
      );
    }, "initial registrations");
    fs.unlinkSync(probe);
    await until(() => probeRemoved, "removal of the registered probe");
    const idle = median(Array.from({ length: 5 }, () => capture().ms));
    fs.renameSync(staging, moved);
    const samples = [];
    await until(() => {
      const sample = capture(traced);
      samples.push(sample);
      return sample.rows === directories * perDirectory;
    }, "all moved files to appear");
    const settled = median(Array.from({ length: 5 }, () => capture().ms));
    return {
      idle,
      longest: Math.max(...samples.map((s) => s.ms)),
      settled,
      snapshots: samples.length,
    };
  } finally {
    await watcher.close();
    if (fs.existsSync(moved)) fs.renameSync(moved, staging);
  }
}
function countPasses(log, probe, boundary) {
  const counts = [];
  let inCall = false;
  for (const line of fs.readFileSync(log, "utf8").split("\n")) {
    if (
      line.includes(JSON.stringify(boundary)) &&
      /^open(at|at2)?\(/.test(line)
    ) {
      inCall = !inCall;
      if (inCall) counts.push(0);
    } else if (
      inCall &&
      line.includes(JSON.stringify(probe)) &&
      /^(newfstatat|statx?|lstat|fstatat64)\(/.test(line)
    ) {
      counts[counts.length - 1]++;
    }
  }
  assert.ok(
    counts.length > 0 && !inCall,
    "trace must contain complete measurement boundaries",
  );
  return counts;
}
if (process.argv[2] === "--one") {
  console.log(
    JSON.stringify(
      await measure(
        process.argv[3],
        process.argv[4],
        process.argv[5] === "trace",
      ),
    ),
  );
} else {
  const sides = {
    base: path.resolve(process.argv[2] || "base/rspack.linux-x64-gnu.node"),
    head: path.resolve(process.argv[3] || "head/rspack.linux-x64-gnu.node"),
  };
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "rspack-snapshot-retries-"),
  );
  const probe = path.join(root, "deps", "probe.js"),
    boundary = path.join(root, "boundary");
  try {
    prepare(root);
    const one = (side, traced = false) => {
      fs.writeFileSync(probe, "probe");
      fs.utimesSync(probe, 1700000000, 1700000000);
      const args = [
        self,
        "--one",
        sides[side],
        root,
        traced ? "trace" : "time",
      ];
      const log = path.join(root, "stat.trace");
      const program = traced ? "strace" : process.execPath;
      const command = traced
        ? [
            "-qq",
            "-e",
            "trace=%file",
            "-P",
            probe,
            "-P",
            boundary,
            "-o",
            log,
            process.execPath,
            ...args,
          ]
        : args;
      const result = JSON.parse(
        execFileSync(program, command, { encoding: "utf8", timeout: 55000 }),
      );
      return traced ? countPasses(log, probe, boundary) : result;
    };
    const timings = { base: [], head: [] };
    for (const side of ["base", "head", "head", "base", "base", "head"]) {
      const result = one(side);
      timings[side].push(result.longest);
      console.log("timing", side, JSON.stringify(result));
    }
    assert.ok(
      median(timings.head) > 2 * median(timings.base),
      "the PR must more than double the median longest synchronous snapshot in this fixture",
    );
    for (const side of ["base", "head"]) {
      const passes = one(side, true);
      console.log("snapshotPasses", side, JSON.stringify(passes));
      if (side === "base") assert.ok(passes.every((n) => n === 1));
      else
        assert.ok(
          passes.some((n) => n > 1),
          "the PR must repeat a collection during the move",
        );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
