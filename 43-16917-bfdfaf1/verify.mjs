import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const aged = new Date("2020-04-05T06:07:08.123Z");

async function scan(binding, directory, expected) {
  const { NativeWatcher } = require(path.resolve(binding));
  const watcher = new NativeWatcher({});
  let deadline;
  try {
    const raw = await new Promise((resolve, reject) => {
      deadline = setTimeout(
        () => reject(new Error("no change reported in 20 seconds")),
        20000,
      );
      const begin = performance.now();
      watcher.watch(
        [[], []],
        [[directory], []],
        [[], []],
        BigInt(Date.now() - 15000),
        (err) => {
          if (err) reject(err);
        },
        (event) =>
          resolve({ elapsed: performance.now() - begin, path: event.path }),
      );
    });
    assert.ok(
      [directory, path.join(directory, "changed.js")].includes(raw.path),
      raw.path,
    );
    const files = watcher
      .collectTimeInfoEntries()
      .fileTimestamps.entries.filter(
        (row) =>
          path.dirname(row.path) === directory &&
          typeof row.timestamp === "number",
      );
    assert.equal(
      files.length,
      expected + 1,
      "backfill must cover all files before counting it",
    );
    return Math.round(raw.elapsed * 10) / 10;
  } finally {
    clearTimeout(deadline);
    await watcher.close();
  }
}

if (process.argv[2] === "--one") {
  console.log(
    await scan(process.argv[3], process.argv[4], Number(process.argv[5])),
  );
} else {
  const sides = process.argv.slice(2, 4);
  if (sides.length === 0)
    sides.push(
      "base/rspack.linux-x64-gnu.node",
      "head/rspack.linux-x64-gnu.node",
    );
  assert.equal(sides.length, 2);
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "rspack-scan-latency-"),
  );
  const sizes = [256, 8192];
  const count = 5;
  try {
    for (const size of sizes) {
      const directory = path.join(fixture, String(size));
      fs.mkdirSync(directory);
      for (let i = 0; i < size; i++) {
        const name = path.join(directory, i + ".js");
        fs.writeFileSync(name, "");
        fs.utimesSync(name, aged, aged);
      }
      const marker = path.join(directory, "changed.js");
      fs.writeFileSync(marker, "changed");
      const readings = [[], []];
      for (let round = 0; round <= count; round++) {
        for (const side of round % 2 === 0 ? [0, 1] : [1, 0]) {
          const now = new Date();
          fs.utimesSync(marker, now, now);
          fs.utimesSync(directory, aged, aged);
          const value = Number(
            execFileSync(
              process.execPath,
              [self, "--one", sides[side], directory, String(size)],
              { encoding: "utf8", timeout: 25000 },
            ).trim(),
          );
          if (round > 0) readings[side].push(value);
        }
      }
      const median = (values) =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      console.log(
        JSON.stringify({
          oldFiles: size,
          baseMs: readings[0],
          headMs: readings[1],
          baseMedianMs: median(readings[0]),
          headMedianMs: median(readings[1]),
        }),
      );
      if (size === 8192) {
        assert.ok(
          median(readings[1]) > 2 * median(readings[0]),
          "the large-directory head median must exceed twice the base median to reproduce",
        );
      }
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
