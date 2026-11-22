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
  const watcher = new NativeWatcher({ aggregateTimeout: 20 });
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
    const outer = path.join(fixture, 'src');
    const inner = path.join(outer, 'nested');
    fs.mkdirSync(inner, { recursive: true });
    const staged = path.join(fixture, 'staged.js');
    fs.writeFileSync(staged, 'generated contents');
    const preserved = new Date(Date.now() - 60000);
    fs.utimesSync(staged, preserved, preserved);
    await start([], [outer, inner], []);

    fs.renameSync(staged, path.join(inner, 'generated.js'));
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
  assert.deepEqual(base.changed, ['src', 'src/nested']);
  assert.equal(head.changed.length, 1);
  assert.ok(base.changed.includes(head.changed[0]));
  assert.deepEqual(base.raw, ['src/nested/generated.js']);
  assert.deepEqual(head.raw, base.raw);
}
