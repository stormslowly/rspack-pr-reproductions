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
const files = 2048,
  closeAt = 32;
async function observe(binding, root, closeDuring) {
  const { NativeWatcher } = require(path.resolve(binding));
  const watched = path.join(root, "watched"),
    seed = path.join(watched, "seed"),
    staging = path.join(root, "staging"),
    moved = path.join(watched, "generated");
  const visits = new Map();
  let closed = false,
    closing,
    total = 0,
    doneAt = 0,
    lastVisit = 0,
    closeCount = 0,
    error;
  const afterClose = new Set();
  const close = () =>
    watcher.close().then(() => {
      closed = true;
      doneAt = performance.now();
      closeCount = total;
    });
  const watcher = new NativeWatcher({
    ignored(name) {
      if (path.dirname(name) === moved) {
        total++;
        visits.set(name, 1 + (visits.get(name) ?? 0));
        if (closed) afterClose.add(name);
        lastVisit = performance.now();
        if (closeDuring && total === closeAt) closing = close();
      }
      return false;
    },
  });
  const until = async (fn, what) => {
    const end = Date.now() + 10000;
    while (!fn()) {
      if (error) throw error;
      if (Date.now() > end)
        throw Error(
          "Timed out waiting for " +
            what +
            ", visits " +
            total +
            " unique " +
            visits.size,
        );
      await delay(10);
    }
  };
  try {
    watcher.watch(
      [[], []],
      [[watched], []],
      [[], []],
      BigInt(Date.now()),
      (e) => {
        if (e) error = e;
      },
      () => {},
    );
    await until(
      () =>
        watcher
          .collectTimeInfoEntries()
          .fileTimestamps.entries.some(
            (r) => r.path === seed && r.timestamp != null,
          ),
      "the initial watch",
    );
    fs.renameSync(staging, moved);
    if (closeDuring) await until(() => closed, "close() to settle");
    else {
      await until(
        () =>
          visits.size === files &&
          watcher
            .collectTimeInfoEntries()
            .fileTimestamps.entries.filter(
              (r) => r.path.startsWith(moved + path.sep) && r.timestamp != null,
            ).length === files,
        "the complete move",
      );
      closing = close();
      await closing;
    }
    await until(
      () => performance.now() - Math.max(lastVisit, doneAt) >= 300,
      "the last callback",
    );
    return {
      unique: visits.size,
      calls: total,
      repeated: [...visits.values()].filter((n) => n > 1).length,
      callsAfterClose: total - closeCount,
      distinctAfterClose: afterClose.size,
      callbackTailMs: Math.round(Math.max(0, lastVisit - doneAt)),
    };
  } finally {
    await (closing ?? watcher.close());
    if (fs.existsSync(moved)) fs.renameSync(moved, staging);
  }
}
if (process.argv[2] === "--one") {
  console.log(
    JSON.stringify(
      await observe(
        process.argv[3],
        process.argv[4],
        process.argv[5] === "during",
      ),
    ),
  );
} else {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "rspack-close-live-scan-"),
  );
  try {
    fs.mkdirSync(path.join(root, "staging"));
    fs.mkdirSync(path.join(root, "watched"));
    const seed = path.join(root, "watched", "seed");
    fs.writeFileSync(seed, "ready");
    fs.utimesSync(seed, 1700000000, 1700000000);
    fs.utimesSync(path.dirname(seed), 1700000000, 1700000000);
    for (let i = 0; i < files; i++)
      fs.writeFileSync(path.join(root, "staging", i + ".js"), "");
    const bins = {
      base: path.resolve(process.argv[2] || "base/rspack.linux-x64-gnu.node"),
      head: path.resolve(process.argv[3] || "head/rspack.linux-x64-gnu.node"),
    };
    for (const mode of ["during", "after"]) {
      for (const side of ["base", "head", "head", "base", "base", "head"]) {
        const bin = bins[side];
        const output = execFileSync(
          process.execPath,
          [self, "--one", bin, root, mode],
          { encoding: "utf8", timeout: 20000 },
        );
        const row = JSON.parse(output);
        console.log(mode, side, JSON.stringify(row));
        const secondPass = mode === "during" && side === "head";
        assert.equal(row.unique, files);
        assert.equal(row.calls, secondPass ? 2 * files : files);
        assert.equal(row.repeated, secondPass ? files : 0);
        if (secondPass) assert.equal(row.distinctAfterClose, files);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
