import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(resolve(binding));
  const root = mkdtempSync(join(tmpdir(), "rspack-posix-name-"));
  const context = join(root, "assets");
  const asset = join(context, "theme\\");
  const marker = join(root, "marker.txt");
  const watcher = new NativeWatcher({});
  try {
    mkdirSync(context);
    for (const file of [asset, marker]) {
      writeFileSync(file, "content");
      utimesSync(file, 1600000000, 1600000000);
    }
    // Missing registrations are backfilled after the initial context scan.
    // Put the marker outside the context so only that backfill can record it.
    let error;
    watcher.watch(
      [[], []],
      [[context], []],
      [[marker], []],
      BigInt(Date.now()),
      (err) => {
        if (err) error = err;
      },
      () => {},
    );
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if (error) throw error;
      const rows = watcher.collectTimeInfoEntries().fileTimestamps.entries;
      if (rows.some((row) => row.path === marker && row.timestamp != null)) {
        return {
          real: rows.some((row) => row.path === asset && row.timestamp != null),
          phantom: rows.some(
            (row) =>
              row.path === join(context, "theme") && row.timestamp != null,
          ),
        };
      }
      await delay(10);
    }
    throw new Error("Timed out waiting for scan completion");
  } finally {
    await watcher.close();
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--one") {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  assert.notEqual(process.platform, "win32", "Requires a POSIX filesystem");
  const [base, head] = process.argv.slice(2);
  assert.ok(base && head, "usage: node verify.mjs BASE.node HEAD.node");
  const run = (file) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--one", file],
        { encoding: "utf8", timeout: 20_000 },
      ),
    );
  const results = { base: run(base), head: run(head) };
  console.log(JSON.stringify(results));
  assert.deepEqual(results.base, { real: true, phantom: false });
  assert.deepEqual(results.head, { real: false, phantom: true });
}
