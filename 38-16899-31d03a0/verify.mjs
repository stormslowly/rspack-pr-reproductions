import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const none = [[], []];

async function until(test, description) {
  const end = performance.now() + 5000;
  while (!test()) {
    if (performance.now() >= end) throw Error(description);
    await delay(5);
  }
}

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(binding);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-failed-add-'));
  const sourceDir = path.join(root, 'source');
  const restricted = path.join(root, 'unreadable');
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(restricted);
  const source = path.join(sourceDir, 'entry.js');
  const ready = path.join(sourceDir, 'ready.js');
  fs.writeFileSync(source, 'before');
  fs.writeFileSync(ready, 'ready');
  const watcher = new NativeWatcher({ aggregateTimeout: 20 });
  const batches = [];
  const errors = [];
  const receive = (error, batch) => {
    if (error) errors.push(error.message);
    else batches.push(batch.changedFiles);
  };
  const includes = (file) => batches.some(batch => batch.includes(file));
  try {
    watcher.watch([[source, ready], []], none, none, BigInt(Date.now() - 5000), receive, () => {});
    await until(() => includes(ready), 'Initial watch did not deliver its readiness batch');
    batches.length = 0;
    fs.chmodSync(restricted, 0o111);
    watcher.watch(none, [[restricted], []], none, BigInt(Date.now()), receive, () => {});
    await until(() => errors.length, 'The new directory should be rejected');
    assert.match(errors[0], /permission denied/i);
    const modified = new Date(Math.trunc(Date.now() / 1000) * 1000 - 60000);
    fs.writeFileSync(source, 'after');
    fs.utimesSync(source, modified, modified);
    // The new timestamp demonstrates that the original OS watch saw this edit.
    await until(() => watcher.collectTimeInfoEntries().fileTimestamps.entries
      .some(e => e.path === source && e.timestamp === modified.getTime()), 'Edit did not reach the watcher');
    await delay(400);
    const reported = includes(source);
    const pending = watcher.peekAggregated().changedFiles.includes(source);
    return { registrationError: 'EACCES', timestampUpdated: true, reported, pending };
  } finally {
    await watcher.close();
    fs.chmodSync(restricted, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
assert.notEqual(process.getuid(), 0, 'Run as a regular user');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  const results = [];
  const binary = 'rspack.linux-x64-gnu.node';
  for (const [i, label] of ['base', 'head'].entries()) {
    const binding = path.resolve(process.argv[i + 2] ?? path.join(label, binary));
    const child = spawnSync(process.execPath, [import.meta.filename, '--worker', binding], {
      encoding: 'utf8', timeout: 15000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    console.log(label, result);
    results.push(result);
  }
  assert.equal(results[0].reported, true);
  assert.equal(results[1].reported, false);
  assert.equal(results[0].pending, false);
  assert.equal(results[1].pending, true);
}
