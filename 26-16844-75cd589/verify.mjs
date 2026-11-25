import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function waitFor(predicate, label) {
  const deadline = performance.now() + 8000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for ' + label);
    await delay(10);
  }
}

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-nested-scan-')));
  const ready = path.join(fixture, 'control', 'ready.js');
  const retired = path.join(fixture, 'control', 'retired-context');
  const outer = path.join(fixture, 'src');
  const inner = path.join(outer, 'pages');
  const staged = path.join(fixture, 'staged', 'admin');
  const movedDir = path.join(inner, 'admin');

  fs.mkdirSync(path.dirname(ready), { recursive: true });
  fs.writeFileSync(ready, 'marker-0');
  fs.mkdirSync(retired, { recursive: true });
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(outer, 'existing.js'), 'module.exports = 0;');

  fs.mkdirSync(path.join(staged, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'route.js'), 'module.exports = 1;');
  fs.writeFileSync(path.join(staged, 'nested', 'deep.js'), 'module.exports = 2;');

  let dropInnerDuringSubtreeScan = false;
  let droppedInner = false;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const changed = new Set();
  const rel = (target) => path.relative(fixture, target);

  let watcher;
  function watch(files, directories, missing) {
    watcher.watch(
      files,
      directories,
      missing,
      BigInt(Date.now() - 5000),
      (error, batch) => {
        assert.ifError(error);
        for (const file of batch.changedFiles) changed.add(rel(file));
      },
      () => {},
    );
  }

  watcher = new NativeWatcher({
    aggregateTimeout: 20,
    ignored(entry) {
      if (dropInnerDuringSubtreeScan && entry.startsWith(movedDir + path.sep)) {
        dropInnerDuringSubtreeScan = false;
        watch([[], []], [[], [inner, retired]], [[], []]);
        const deadline = performance.now() + 5000;
        while (
          watcher
            .collectTimeInfoEntries()
            .directoryTimestamps.entries.some((row) => row.path === retired)
        ) {
          if (performance.now() >= deadline) {
            throw new Error('Timed out waiting for inner context unsubscription');
          }
          Atomics.wait(sleeper, 0, 0, 1);
        }
        droppedInner = true;
      }
      return false;
    },
  });

  try {
    watch([[ready], []], [[outer, inner, retired], []], [[], []]);
    await waitFor(() => {
      const snapshot = watcher.collectTimeInfoEntries();
      const files = new Set(snapshot.fileTimestamps.entries.map((row) => rel(row.path)));
      const dirs = new Set(snapshot.directoryTimestamps.entries.map((row) => rel(row.path)));
      return (
        files.has('src/existing.js') &&
        dirs.has('src') &&
        dirs.has('src/pages') &&
        dirs.has('control/retired-context')
      );
    }, 'the initial context scan');
    changed.clear();

    dropInnerDuringSubtreeScan = true;
    fs.renameSync(staged, movedDir);
    await waitFor(() => droppedInner, 'the inner context unsubscription during subtree scan');

    // Touching movedDir afterwards still does not rescan it because movedDir is already
    // recorded as a known directory member under `src/pages`.
    const now = new Date();
    fs.utimesSync(movedDir, now, now);

    // Fence behind EventProcessor: because EventProcessor is single-threaded and awaits
    // set_context_entry(movedDir) -> scan_below([movedDir]), delivering a later event on
    // `ready` proves both the subtree scan and the follow-up directory touch have settled.
    changed.clear();
    fs.writeFileSync(ready, 'marker-1');
    await waitFor(() => changed.has('control/ready.js'), 'the post-scan fence event');

    const snapshot = watcher.collectTimeInfoEntries();
    const fileEntries = snapshot.fileTimestamps.entries
      .filter((row) => !row.existenceOnly)
      .map((row) => rel(row.path))
      .filter((name) => name.startsWith('src/'))
      .sort();
    const directoryEntries = snapshot.directoryTimestamps.entries
      .map((row) => rel(row.path))
      .filter((name) => name === 'src' || name.startsWith('src/'))
      .sort();

    return { fileEntries, directoryEntries };
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
      timeout: 20000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const binary = 'rspack.linux-x64-gnu.node';
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }, null, 2));

  assert.deepEqual(base.fileEntries, [
    'src/existing.js',
    'src/pages/admin/nested/deep.js',
    'src/pages/admin/route.js',
  ]);
  assert.deepEqual(base.directoryEntries, [
    'src',
    'src/pages',
    'src/pages/admin',
    'src/pages/admin/nested',
  ]);

  assert.deepEqual(head.fileEntries, ['src/existing.js']);
  assert.deepEqual(head.directoryEntries, ['src', 'src/pages', 'src/pages/admin']);
}
