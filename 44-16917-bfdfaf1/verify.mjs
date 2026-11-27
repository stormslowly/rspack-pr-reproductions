import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const directories = 32;
const filesPerDirectory = 1;

function workerCount() {
  let workers = 0;
  for (const tid of fs.readdirSync("/proc/self/task")) {
    try {
      const name = fs
        .readFileSync("/proc/self/task/" + tid + "/comm", "utf8")
        .trim();
      if (name === "tokio-rt-worker") workers++;
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ESRCH") throw e;
    }
  }
  return workers;
}

async function until(ready) {
  const limit = Date.now() + 15000;
  while (!ready()) {
    if (Date.now() > limit)
      throw Error("Timed out waiting for the watcher to index the fixture");
    await delay(20);
  }
}

async function observe(binding, root, mode) {
  const { NativeWatcher } = require(path.resolve(binding));
  const staging = path.join(root, "staging");
  const watched = path.join(root, "watched");
  const moved = path.join(watched, "generated");
  const seed = path.join(watched, "seed.js");
  const watcher = new NativeWatcher({});
  let failure;
  const files = () => {
    if (failure) throw failure;
    return watcher.collectTimeInfoEntries().fileTimestamps.entries;
  };
  let before = workerCount();
  try {
    const context = mode === "initial" ? staging : watched;
    watcher.watch(
      [[], []],
      [[context], []],
      [[], []],
      BigInt(Date.now() + 60000),
      (error) => {
        if (error) failure = error;
      },
      () => {},
    );
    if (mode === "move") {
      await until(() =>
        files().some((row) => row.path === seed && row.timestamp != null),
      );
      before = workerCount();
      fs.renameSync(staging, moved);
    }
    const prefix = (mode === "move" ? moved : staging) + path.sep;
    await until(
      () =>
        files().filter(
          (row) => row.path.startsWith(prefix) && row.timestamp != null,
        ).length ===
        directories * filesPerDirectory,
    );
    const after = workerCount();
    return { before, after, added: after - before };
  } finally {
    await watcher.close();
    if (mode === "move" && fs.existsSync(moved)) fs.renameSync(moved, staging);
  }
}

if (process.argv[2] === "--one") {
  console.log(
    JSON.stringify(
      await observe(process.argv[3], process.argv[4], process.argv[5]),
    ),
  );
} else {
  assert.equal(process.platform, "linux");
  const status = fs.readFileSync("/proc/self/status", "utf8");
  const cpuList = /^Cpus_allowed_list:\s*(\d+)/m.exec(status);
  assert.ok(cpuList, "read the first CPU allowed for this test process");
  const cpu = cpuList[1];
  const sides = {
    base: path.resolve(process.argv[2] || "base/rspack.linux-x64-gnu.node"),
    head: path.resolve(process.argv[3] || "head/rspack.linux-x64-gnu.node"),
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rspack-subtree-move-"));
  try {
    fs.mkdirSync(path.join(root, "watched"));
    fs.writeFileSync(path.join(root, "watched", "seed.js"), "");
    for (let i = 0; i < directories; i++) {
      const directory = path.join(root, "staging", String(i));
      fs.mkdirSync(directory, { recursive: true });
      for (let j = 0; j < filesPerDirectory; j++)
        fs.writeFileSync(path.join(directory, j + ".js"), "");
    }
    for (const mode of ["initial", "move"]) {
      const rows = { base: [], head: [] };
      for (const side of ["base", "head", "head", "base", "base", "head"]) {
        const data = JSON.parse(
          execFileSync(
            "taskset",
            [
              "--cpu-list",
              cpu,
              process.execPath,
              self,
              "--one",
              sides[side],
              root,
              mode,
            ],
            { encoding: "utf8", timeout: 20000 },
          ),
        );
        rows[side].push(data.added);
      }
      console.log(mode, JSON.stringify(rows));
      assert.ok(rows.base.every((n) => n === 0));
      if (mode === "initial") assert.ok(rows.head.every((n) => n <= 16));
      if (mode === "move")
        assert.ok(
          rows.head.some((n) => n > 16),
          "no live subtree scan exceeded 16 new workers on this machine",
        );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
