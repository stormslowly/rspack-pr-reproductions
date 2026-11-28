import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

async function until(predicate, description) {
  const end = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > end)
      throw new Error("Timed out waiting for " + description);
    await delay(10);
  }
}

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(resolve(binding));
  const root = mkdtempSync(join(tmpdir(), "rspack-missing-dir-"));
  const dependency = join(root, "generated");
  const marker = join(root, "ready.txt");
  const watcher = new NativeWatcher({ aggregateTimeout: 30 });
  let error,
    changed = false;
  try {
    writeFileSync(marker, "ready");
    utimesSync(marker, 1600000000, 1600000000);
    watcher.watch(
      [[], []],
      [[], []],
      [[dependency, marker], []],
      BigInt(Date.now()),
      (err, result) => {
        if (err) error = err;
        else if (result.changedFiles.includes(dependency)) changed = true;
      },
      () => {},
    );
    const snapshot = () => {
      if (error) throw error;
      return watcher.collectTimeInfoEntries().fileTimestamps;
    };
    await until(
      () => snapshot().entries.some((row) => row.path === marker),
      "registration and the first scan",
    );
    assert.ok(snapshot().missing.includes(dependency));
    mkdirSync(dependency);
    await until(() => {
      if (error) throw error;
      return changed;
    }, "a real directory creation event");
    const result = snapshot();
    return {
      onDisk: statSync(dependency).isDirectory(),
      changed,
      listedAsMissing: result.missing.includes(dependency),
      hasEntry: result.entries.some((row) => row.path === dependency),
    };
  } finally {
    await watcher.close();
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--one") {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  const [base, head] = process.argv.slice(2);
  assert.ok(base && head, "usage: node verify.mjs BASE.node HEAD.node");
  const run = (file) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--one", file],
        { encoding: "utf8", timeout: 30_000 },
      ),
    );
  const results = { base: run(base), head: run(head) };
  console.log(JSON.stringify(results));
  assert.deepEqual(results.base, {
    onDisk: true,
    changed: true,
    listedAsMissing: false,
    hasEntry: true,
  });
  assert.deepEqual(results.head, {
    onDisk: true,
    changed: true,
    listedAsMissing: true,
    hasEntry: false,
  });
}
