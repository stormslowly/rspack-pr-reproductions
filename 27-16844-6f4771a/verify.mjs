import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function observe(binding, touchDuringScan) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-scan-link-')));
  const root = path.join(fixture, 'src');
  const branch = path.join(root, 'workspace');
  const packages = path.join(branch, 'packages');
  const entryFile = path.join(packages, 'entry.js');
  const link = path.join(packages, 'shared');
  const target = path.join(fixture, 'store', 'shared');
  const child = path.join(link, 'route.js');
  const marker = path.join(fixture, 'next-watch.js');
  fs.mkdirSync(packages, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(entryFile, '');
  fs.writeFileSync(marker, '');
  fs.writeFileSync(path.join(target, 'route.js'), 'module.exports = 1;\n');
  fs.symlinkSync(target, link, 'dir');
  for (let i = 0; i < 64; i++) fs.writeFileSync(path.join(root, 'source-' + i + '.js'), '');

  let touched = false;
  let linkObservedBeforeDescent = false;
  const watcher = new NativeWatcher({
    followSymlinks: true,
    ignored(entry) {
      if (touchDuringScan && !touched && path.dirname(entry) === root) {
        touched = true;
        const now = new Date();
        fs.lutimesSync(link, now, now);
      }
      if (touchDuringScan && entry === packages) {
        linkObservedBeforeDescent = watcher.collectTimeInfoEntries().fileTimestamps.entries
          .some(row => row.path === link && row.timestamp != null);
      }
      return false;
    },
  });

  try {
    watcher.watch([[entryFile], []], [[root], []], [[], []], BigInt(Date.now()), assert.ifError, () => {});
    // Applying this registration proves that the first watch finished its scan.
    watcher.watch([[marker], []], [[], []], [[], []], BigInt(Date.now()), assert.ifError, () => {});
    const deadline = performance.now() + 8000;
    while (!watcher.collectTimeInfoEntries().fileTimestamps.entries.some(row => row.path === marker)) {
      if (performance.now() >= deadline) throw new Error('Timed out waiting for the second watch');
      await delay(2);
    }
    const snapshot = watcher.collectTimeInfoEntries();
    assert.ok(fs.statSync(child).isFile());
    if (touchDuringScan) {
      assert.ok(touched, 'the initial scan must reach the trigger');
      assert.ok(linkObservedBeforeDescent, 'the native link event must precede the walk of packages');
    }
    return {
      aliasDirectory: snapshot.directoryTimestamps.entries.some(row => row.path === link),
      fileThroughAlias: snapshot.fileTimestamps.entries.some(row => row.path === child && row.timestamp != null),
    };
  } finally {
    await watcher.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3], process.argv[4] !== 'quiet')));
} else {
  function run(binding, mode = 'overlap') {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding, mode], {
      encoding: 'utf8',
      timeout: 20000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const binary = 'rspack.linux-x64-gnu.node';
  const headBinding = process.argv[3] ?? path.join('head', binary);
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(headBinding);
  const headWithoutTouch = run(headBinding, 'quiet');
  console.log(JSON.stringify({ base, head, headWithoutTouch }));
  assert.deepEqual(base, { aliasDirectory: true, fileThroughAlias: true });
  assert.deepEqual(head, { aliasDirectory: false, fileThroughAlias: false });
  assert.deepEqual(headWithoutTouch, base);
}
