import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const empty = [[], []];
const script = fileURLToPath(import.meta.url);
const binary = 'rspack.linux-x64-gnu.node';
assert.equal(process.platform, 'linux', 'Run on Linux with inotify');

function kernelWatches(dir) {
  const inode = fs.statSync(dir, { bigint: true }).ino.toString(16);
  for (const fd of fs.readdirSync('/proc/self/fdinfo')) {
    try {
      const info = fs.readFileSync('/proc/self/fdinfo/' + fd, 'utf8');
      if (
        info
          .split('\n')
          .some(
            (line) =>
              line.startsWith('inotify ') &&
              line.includes(' ino:' + inode + ' '),
          )
      )
        return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

async function waitFor(ready, label) {
  const deadline = performance.now() + 5000;
  while (!ready()) {
    if (performance.now() >= deadline)
      throw new Error('Timed out waiting for ' + label);
    await delay(10);
  }
}

function oldFile(file) {
  fs.writeFileSync(file, 'original');
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(file, old, old);
}

function startWatcher(binding, root, options = {}) {
  const { NativeWatcher } = createRequire(import.meta.url)(
    path.resolve(binding),
  );
  const watcher = new NativeWatcher({ aggregateTimeout: 10, ...options });
  const changed = new Set();
  const raw = new Set();
  const errors = [];
  function watch(files = empty, directories = empty, missing = empty) {
    watcher.watch(
      files,
      directories,
      missing,
      BigInt(Date.now() - 10000),
      (error, result) => {
        if (error) errors.push(error.message.replaceAll(root, '<fixture>'));
        else for (const file of result.changedFiles) changed.add(file);
      },
      (event) => raw.add(event.path),
    );
  }
  return { watch, changed, raw, errors, close: () => watcher.close() };
}

function runWorker(binding, ...extra) {
  const args = [script, '--worker', path.resolve(binding), ...extra];
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function observe(binding, variant) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-recreate-dir-'));
  const src = path.join(root, 'src');
  const sub = path.join(src, 'generated');
  const stage = path.join(root, 'stage');
  const control = path.join(root, 'control');
  for (const dir of [src, sub, stage, control]) fs.mkdirSync(dir);
  const retained = path.join(sub, 'entry.js');
  const later = path.join(sub, 'later.js');
  const oldInode = fs.statSync(sub, { bigint: true }).ino;
  const newInode = fs.statSync(stage, { bigint: true }).ino;
  assert.notEqual(oldInode, newInode);
  for (const name of ['entry.js', 'later.js']) oldFile(path.join(stage, name));
  const keepExplicit = variant === 'recreate';
  if (keepExplicit) {
    oldFile(retained);
    oldFile(later);
  }
  const ready0 = path.join(control, 'ready0.js');
  const ready1 = path.join(control, 'ready1.js');
  const ready2 = path.join(control, 'ready2.js');
  const controlFiles = [0, 1, 2].map((i) =>
    path.join(control, 'live-' + i + '.js'),
  );
  fs.writeFileSync(ready0, 'shallow registration');
  fs.writeFileSync(ready1, 'recursive registration');
  fs.writeFileSync(ready2, 'next registration');
  for (const file of controlFiles) oldFile(file);
  const missing = path.join(src, 'unresolved', 'entry.js');
  const h = startWatcher(binding, root);
  try {
    const files = [ready0, ...controlFiles];
    if (keepExplicit) files.push(retained);
    h.watch([files, []], [[src], []]);
    await waitFor(() => h.changed.has(ready0), 'shallow registration');
    h.watch([[ready1], [ready0]], empty, [[missing], []]);
    await waitFor(() => h.changed.has(ready1), 'recursive registration');
    assert.ok(kernelWatches(src) && kernelWatches(sub));
    const newSibling = path.join(src, 'new-sibling');
    fs.mkdirSync(newSibling);
    await waitFor(
      () => kernelWatches(newSibling),
      'recursive coverage of a new sibling',
    );
    if (keepExplicit) {
      fs.rmSync(sub, { recursive: true });
      fs.writeFileSync(controlFiles[0], 'after deletion');
      await waitFor(
        () => h.changed.has(controlFiles[0]),
        'the completed deletion events',
      );
      await delay(100);
    }
    // In the atomic variant the old destination is an empty directory.
    fs.renameSync(stage, sub);
    fs.writeFileSync(controlFiles[1], 'after replacement');
    await waitFor(
      () => h.changed.has(controlFiles[1]),
      'the completed replacement events',
    );
    await delay(130);
    const watchedAfterRename = kernelWatches(sub);
    h.watch([[ready2], [ready1]]);
    await waitFor(
      () => h.changed.has(ready2),
      'the next successful watch registration',
    );
    await delay(100);
    h.raw.clear();
    h.changed.clear();
    fs.writeFileSync(later, 'live edit in the replacement directory');
    if (keepExplicit)
      fs.writeFileSync(retained, 'live edit to the retained dependency');
    fs.writeFileSync(controlFiles[2], 'independent edit');
    await waitFor(
      () => h.changed.has(controlFiles[2]),
      'the final independent edit',
    );
    if (!h.raw.has(later) || !h.changed.has(src)) await delay(350);
    return {
      watchedAfterRename,
      watchedAfterRegistration: kernelWatches(sub),
      fileEvent: h.raw.has(later),
      contextEvent: h.changed.has(src),
      ...(keepExplicit
        ? { explicitFileEvent: h.raw.has(retained) && h.changed.has(retained) }
        : {}),
      controlEvent: h.changed.has(controlFiles[2]),
      errors: h.errors,
    };
  } finally {
    await h.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3], process.argv[4])));
} else {
  const baseBinding = process.argv[2] ?? path.join('base', binary);
  const headBinding = process.argv[3] ?? path.join('head', binary);
  for (const variant of ['recreate', 'atomic']) {
    const base = runWorker(baseBinding, variant);
    const head = runWorker(headBinding, variant);
    console.log(JSON.stringify({ variant, base, head }));
    assert.ok(base.controlEvent && head.controlEvent);
    assert.deepEqual(base.errors, []);
    assert.deepEqual(head.errors, []);
    assert.ok(
      base.watchedAfterRename &&
        base.watchedAfterRegistration &&
        base.fileEvent &&
        base.contextEvent,
    );
    if (variant === 'recreate') {
      assert.ok(base.explicitFileEvent);
      assert.equal(head.explicitFileEvent, false);
    }
    for (const key of [
      'watchedAfterRename',
      'watchedAfterRegistration',
      'fileEvent',
      'contextEvent',
    ])
      assert.equal(head[key], false);
  }
}
