const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { NativeWatcher } = require(path.resolve(process.argv[2]));
const count = Number(process.argv[3]);
const root = path.resolve(process.argv[4]);
fs.mkdirSync(root, { recursive: true });
const file = path.join(root, "measured.js");
const marker = path.join(root, "done.js");
const ready = path.join(root, "ready.js");
for (const entry of [file, marker, ready]) {
  fs.writeFileSync(entry, "x");
  fs.utimesSync(entry, 1600000000, 1600000000);
}
const watcher = new NativeWatcher({ aggregateTimeout: 15 });
let caught,
  done = false;
async function until(predicate) {
  const end = Date.now() + 20000;
  while (!predicate()) {
    if (caught) throw caught;
    assert.ok(Date.now() < end);
    await delay(5);
  }
}
(async () => {
  try {
    watcher.watch(
      [[file, marker], []],
      [[], []],
      [[ready], []],
      BigInt(Date.now() + 60000),
      (err, result) => {
        if (err) caught = err;
        else if (result.changedFiles.includes(marker)) done = true;
      },
      () => {},
    );
    await until(() =>
      watcher
        .collectTimeInfoEntries()
        .fileTimestamps.entries.some((row) => row.path === ready),
    );
    for (let i = 0; i < count; i++) watcher.triggerEvent("change", file);
    watcher.triggerEvent("remove", marker);
    await until(() => done);
  } finally {
    await watcher.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
