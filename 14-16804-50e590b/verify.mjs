import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function waitFor(predicate, label) {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for ' + label);
    await delay(10);
  }
}

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-watch-'));
  const ready = path.join(fixture, 'control', 'ready.js');
  fs.mkdirSync(path.dirname(ready));
  fs.writeFileSync(ready, 'registration marker');
  const obsolete = path.join(fixture, 'old.js');
  fs.writeFileSync(obsolete, 'initial contents');
  let revokeWhileFiltering = false;
  let revoked = false;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const watcher = new NativeWatcher({
    aggregateTimeout: 20,
    ignored(file) {
      if (file !== obsolete || !revokeWhileFiltering) return false;
      revokeWhileFiltering = false;
      watch([[], [obsolete]], [[], []], [[], []]);
      const deadline = performance.now() + 5000;
      while (watcher.collectTimeInfoEntries().fileTimestamps.entries.some((e) => e.path === obsolete)) {
        if (performance.now() >= deadline) throw new Error('Timed out waiting for removal');
        Atomics.wait(sleeper, 0, 0, 1);
      }
      revoked = true;
      return false;
    },
  });
  const changed = new Set();
  const removed = new Set();
  const raw = new Set();
  const name = (file) => path.relative(fixture, file);
  function watch(files, directories, missing) {
    watcher.watch(files, directories, missing, BigInt(Date.now() - 5000),
      (error, batch) => {
        assert.ifError(error);
        for (const file of batch.changedFiles) changed.add(name(file));
        for (const file of batch.removedFiles) removed.add(name(file));
      }, (event) => raw.add(name(event.path)));
  }
  async function start(files, dirs, missing) {
    watch([[ready, ...files], []], [dirs, []], [missing, []]);
    await waitFor(() => changed.has(name(ready)), 'the initial scan');
    await delay(80);
    changed.clear();
    removed.clear();
    raw.clear();
  }
  async function finish() {
    fs.writeFileSync(ready, 'live marker');
    await waitFor(() => changed.has(name(ready)), 'a subsequent live inotify event');
    await delay(80);
    changed.delete(name(ready));
    raw.delete(name(ready));
    return { changed: [...changed].sort(), removed: [...removed].sort(), raw: [...raw].sort() };
  }
  try {
    await start([obsolete], [], []);
    revokeWhileFiltering = true;
    fs.writeFileSync(obsolete, 'one edit before the next watch cycle');
    await waitFor(() => revoked, 'the concurrent watch update');
    return await finish();
  } finally {
    await watcher.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  function run(binding) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding],
      { encoding: 'utf8', timeout: 20000 });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const binary = 'rspack.linux-x64-gnu.node';
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }));
  assert.deepEqual(base.changed, []);
  assert.deepEqual(head.changed, ['old.js']);
  assert.deepEqual(base.raw, []);
  assert.deepEqual(head.raw, ['old.js']);
}
