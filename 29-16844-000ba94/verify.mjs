import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function until(predicate, description) {
  const deadline = performance.now() + 8000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('Timed out waiting for ' + description);
    await delay(2);
  }
}

async function observe(binding, writeAgain) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-pending-file-'));
  const outer = path.join(tmp, 'src');
  const inner = path.join(outer, 'pages');
  const target = path.join(inner, 'route.js');
  const control = path.join(tmp, 'control');
  const fence = path.join(control, 'fence.js');
  const firstRegistration = path.join(control, 'first.js');
  const secondRegistration = path.join(control, 'second.js');
  const busy = path.join(tmp, 'busy');
  const warm = path.join(busy, 'warm.js');
  const staged = path.join(tmp, 'staged');
  const moved = path.join(busy, 'generated');
  const busyFiles = 256;
  for (const dir of [inner, control, busy, staged]) fs.mkdirSync(dir, { recursive: true });
  for (const name of [target, warm, fence, firstRegistration, secondRegistration]) {
    fs.writeFileSync(name, '');
    fs.utimesSync(name, 1600000000.123, 1600000000.123);
  }
  for (let i = 0; i < busyFiles; i++) fs.writeFileSync(path.join(staged, String(i)), '');

  const changes = new Set();
  let rawCount = 0;
  let busyVisits = 0;
  let release = false;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const watcher = new NativeWatcher({
    aggregateTimeout: 10,
    ignored(entry) {
      if (path.dirname(entry) === moved) {
        busyVisits++;
        if (!release) Atomics.wait(sleeper, 0, 0, 2);
      }
      return false;
    },
  });
  function watch(files, dirs, start = Date.now()) {
    watcher.watch([files, []], [dirs, []], [[], []], BigInt(start), (err, event) => {
      assert.ifError(err);
      for (const name of event.changedFiles) changes.add(name);
    }, event => {
      if (event.path === target && event.kind === 'change') rawCount++;
    });
  }
  function timestamp(name) {
    return watcher.collectTimeInfoEntries().fileTimestamps.entries.find(row => row.path === name)?.timestamp;
  }
  try {
    watch([fence], [busy]);
    await until(() => timestamp(warm) != null, 'the initial directory scan');
    // The explicit control files establish a 10 ms or finer timestamp window.
    await delay(60);
    const outerStart = Date.now();
    fs.writeFileSync(target, 'first write');
    const firstTime = Math.round(fs.statSync(target).mtimeMs);
    fs.renameSync(staged, moved);
    await until(() => busyVisits > 0, 'the separate move event');

    watch([], [outer], outerStart);
    watch([firstRegistration], []);
    await until(() => timestamp(firstRegistration) != null, 'the completed outer scan');
    assert.equal(timestamp(target), firstTime);
    if (writeAgain) {
      await delay(20);
      fs.writeFileSync(target, 'second write');
    }
    const finalTime = Math.round(fs.statSync(target).mtimeMs);
    assert.equal(finalTime === firstTime, !writeAgain);
    await delay(60);
    const innerStart = Date.now();
    assert.ok(finalTime + 10 < innerStart);
    watch([], [inner], innerStart);
    watch([secondRegistration], []);
    await until(() => timestamp(secondRegistration) != null, 'the completed nested scan');
    assert.equal(timestamp(target), finalTime);
    assert.ok(busyVisits < busyFiles, 'the earlier event must still occupy the event processor');
    release = true;
    fs.writeFileSync(fence, 'flush');
    await until(() => changes.has(fence), 'the aggregate for a later file event');
    return { fileNotifications: rawCount, outerChanged: changes.has(outer) };
  } finally {
    release = true;
    await watcher.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3], process.argv[4] !== 'unchanged')));
} else {
  function run(binding, mode = 'changed') {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding, mode], {
      encoding: 'utf8', timeout: 20000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const binary = 'rspack.linux-x64-gnu.node';
  const baseBinding = process.argv[2] ?? path.join('base', binary);
  const headBinding = process.argv[3] ?? path.join('head', binary);
  const base = run(baseBinding);
  const head = run(headBinding);
  const headWithoutSecondWrite = run(headBinding, 'unchanged');
  console.log(JSON.stringify({ base, head, headWithoutSecondWrite }));
  assert.deepEqual(base, { fileNotifications: 1, outerChanged: true });
  assert.deepEqual(head, { fileNotifications: 0, outerChanged: false });
  assert.deepEqual(headWithoutSecondWrite, base);
}
