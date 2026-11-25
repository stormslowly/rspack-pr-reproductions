import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const memberCount = 8192;

async function waitFor(predicate, description) {
  const deadline = performance.now() + 15000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('Timed out waiting for ' + description);
    await delay(2);
  }
}

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-retired-scan-')));
  const root = path.join(fixture, 'src');
  const warm = path.join(root, 'initial.js');
  const control = path.join(fixture, 'control');
  const retired = path.join(control, 'retired');
  const marker = path.join(control, 'retained.js');
  const staged = path.join(fixture, 'staged');
  const moved = path.join(root, 'generated');
  fs.mkdirSync(root);
  fs.mkdirSync(retired, { recursive: true });
  fs.mkdirSync(staged);
  fs.writeFileSync(warm, '');
  fs.writeFileSync(marker, 'before');
  fs.utimesSync(marker, 1600000000, 1600000000);
  for (let i = 0; i < memberCount; i++) fs.writeFileSync(path.join(staged, i + '.js'), '');

  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let started = false;
  let callbacksAfterUnsubscribe = 0;
  let markerWrittenAt;
  let markerDeliveredAt;
  const watcher = new NativeWatcher({
    aggregateTimeout: 10,
    ignored(entry) {
      if (path.dirname(entry) !== moved) return false;
      if (started) {
        callbacksAfterUnsubscribe++;
        return false;
      }
      started = true;
      watch([[], []], [[], [root, retired]]);
      // 'retired' is removed after 'root'. No additions in this watch request need JS.
      const deadline = performance.now() + 5000;
      while (watcher.collectTimeInfoEntries().directoryTimestamps.entries.some(row => row.path === retired)) {
        if (performance.now() >= deadline) throw new Error('Timed out waiting for watch removal');
        Atomics.wait(sleeper, 0, 0, 1);
      }
      markerWrittenAt = performance.now();
      fs.writeFileSync(marker, 'after');
      return false;
    },
  });

  function watch(files, directories) {
    watcher.watch(files, directories, [[], []], BigInt(Date.now()), assert.ifError, event => {
      if (event.path === marker && markerWrittenAt !== undefined) {
        markerDeliveredAt ??= performance.now();
      }
    });
  }

  try {
    watch([[marker], []], [[root, retired], []]);
    await waitFor(
      () => watcher.collectTimeInfoEntries().fileTimestamps.entries.some(row => row.path === warm),
      'the initial scan',
    );
    fs.renameSync(staged, moved);
    await waitFor(() => markerDeliveredAt !== undefined, 'the change to the retained file');
    return {
      callbacksAfterUnsubscribe,
      markerDelayMs: Math.round(markerDeliveredAt - markerWrittenAt),
    };
  } finally {
    await watcher.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  function run(binding) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding], {
      encoding: 'utf8',
      timeout: 30000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const binary = 'rspack.linux-x64-gnu.node';
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ memberCount, base, head }));
  assert.equal(base.callbacksAfterUnsubscribe, 0);
  assert.equal(head.callbacksAfterUnsubscribe, memberCount - 1);
}
