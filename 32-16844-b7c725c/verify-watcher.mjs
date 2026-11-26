import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const old = 1600000000.123;

async function observe(binding, replaceParent) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-retained-watch-'));
  const root = path.join(tmp, 'src');
  const parent = path.join(root, 'pages');
  const target = path.join(parent, 'restored');
  const staged = path.join(tmp, 'staged');
  const control = path.join(tmp, 'control');
  const marker = path.join(control, 'marker');
  const ready = path.join(control, 'ready');
  const done = path.join(control, 'done');
  for (const dir of [parent, staged, control]) fs.mkdirSync(dir, { recursive: true });
  for (const file of [marker, ready, done]) {
    fs.writeFileSync(file, '');
    fs.utimesSync(file, old, old);
  }
  const watcher = new NativeWatcher({ aggregateTimeout: 10 });
  const changes = new Set();
  function watch(files, addedContexts, removedContexts, missing, start = Date.now()) {
    watcher.watch([files, []], [addedContexts, removedContexts], [missing, []], BigInt(start),
      (error, batch) => {
        assert.ifError(error);
        for (const file of batch.changedFiles) changes.add(file);
      }, () => {});
  }
  function snapshot(file) {
    const table = watcher.collectTimeInfoEntries().fileTimestamps;
    if (table.missing.includes(file)) return null;
    return table.entries.find(row => row.path === file && row.timestamp != null)?.timestamp;
  }
  async function until(check, description) {
    const deadline = performance.now() + 6000;
    while (!check()) {
      if (performance.now() >= deadline) throw new Error('Timed out waiting for ' + description);
      await delay(3);
    }
  }

  try {
    watch([marker], [], [], [target]);
    watch([ready], [], [], []);
    await until(() => snapshot(ready) != null, 'the first watch');
    await delay(60);
    assert.equal(snapshot(target), null);
    const start = Date.now();
    await delay(20);
    const restored = replaceParent ? path.join(staged, 'restored') : target;
    fs.mkdirSync(restored);
    fs.utimesSync(restored, old, old);
    if (replaceParent) {
      fs.renameSync(parent, path.join(tmp, 'previous-pages'));
      fs.renameSync(staged, parent);
    }
    assert.ok(fs.statSync(target).birthtimeMs >= start);
    watch([], [root], [], [], start);
    await until(() => changes.has(root) && changes.has(target), 'the restoration notification');
    watch([], [], [root], []);
    watch([done], [], [], []);
    await until(() => snapshot(done) != null, 'context removal');
    const afterRemoval = snapshot(target);
    changes.clear();
    fs.chmodSync(target, 0o700);
    fs.writeFileSync(marker, 'flush');
    await until(() => changes.has(marker), 'the subsequent control write');
    assert.ok(fs.statSync(target).isDirectory());
    return { disk: Math.round(fs.statSync(target).mtimeMs), afterRemoval, afterChmod: snapshot(target) };
  } finally {
    await watcher.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3], process.argv[4] !== 'direct')));
} else {
  function run(binding, mode = 'replace-parent') {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding, mode], {
      encoding: 'utf8', timeout: 16000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const binary = 'rspack.linux-x64-gnu.node';
  const base = run(process.argv[2] ?? path.join('base', binary));
  const headBinding = process.argv[3] ?? path.join('head', binary);
  const head = run(headBinding);
  const headDirectCreation = run(headBinding, 'direct');
  console.log(JSON.stringify({ base, head, headDirectCreation }));
  const disk = 1600000000123;
  assert.deepEqual(base, { disk, afterRemoval: disk, afterChmod: disk });
  assert.deepEqual(head, { disk, afterRemoval: null, afterChmod: null });
  assert.deepEqual(headDirectCreation, base);
}
