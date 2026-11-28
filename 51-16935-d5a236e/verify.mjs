import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

async function observe(binding, slash) {
  const { NativeWatcher } = createRequire(import.meta.url)(resolve(binding));
  const root = mkdtempSync(join(tmpdir(), "rspack-nested-alias-"));
  const outer = join(root, "outer");
  const inner = join(outer, "inner");
  const marker = join(root, "ready");
  mkdirSync(inner, { recursive: true });
  writeFileSync(marker, "");
  utimesSync(marker, 1600000000, 1600000000);
  const watcher = new NativeWatcher({ aggregateTimeout: 30 });
  const changes = new Set(),
    removals = new Set();
  let error;
  async function until(predicate) {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
      if (error) throw error;
      if (Date.now() > deadline)
        throw new Error("Timed out waiting for the watcher");
      await delay(10);
    }
  }
  try {
    // Let the creation time of the empty directory fall outside the initial scan's accuracy window.
    await delay(2100);
    watcher.watch(
      [[], []],
      [[outer, slash ? inner + "/" : inner], []],
      [[marker], []],
      BigInt(Date.now()),
      (err, result) => {
        if (err) {
          error = err;
          return;
        }
        for (const name of result.changedFiles) changes.add(name);
        for (const name of result.removedFiles) removals.add(name);
      },
      () => {},
    );
    await until(() =>
      watcher
        .collectTimeInfoEntries()
        .fileTimestamps.entries.some((row) => row.path === marker),
    );
    rmdirSync(inner);
    await until(() => changes.has(outer));
    await delay(180);
    // Keep the original spelling, including any trailing slash.
    const names = (entries) =>
      [...entries].map((name) => name.slice(root.length + 1)).sort();
    return { changed: names(changes), removed: names(removals) };
  } finally {
    await watcher.close();
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--one") {
  console.log(
    JSON.stringify(await observe(process.argv[3], process.argv[4] === "slash")),
  );
} else {
  const [base, head] = process.argv.slice(2);
  assert.ok(base && head, "usage: node verify.mjs BASE.node HEAD.node");
  const run = (binding, spelling) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--one", binding, spelling],
        { encoding: "utf8", timeout: 20_000 },
      ),
    );
  const result = {
    base: { plain: run(base, "plain"), slash: run(base, "slash") },
    head: { plain: run(head, "plain"), slash: run(head, "slash") },
  };
  console.log(JSON.stringify(result));
  const expected = { changed: ["outer"], removed: [] };
  assert.deepEqual(result.base.plain, expected);
  assert.deepEqual(result.base.slash, expected);
  assert.deepEqual(result.head.plain, expected);
  assert.deepEqual(result.head.slash, {
    changed: ["outer", "outer/inner/"],
    removed: [],
  });
}
