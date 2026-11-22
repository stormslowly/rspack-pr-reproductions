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

async function observe(binding, followSymlinks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-existing-link-'));
  const src = path.join(root, 'src');
  const external = path.join(root, 'workspace-package');
  const targetDir = path.join(external, 'lib');
  const link = path.join(src, 'package');
  const control = path.join(root, 'control');
  for (const dir of [src, external, targetDir, control]) fs.mkdirSync(dir);
  fs.symlinkSync(external, link, 'dir');
  const physical = path.join(targetDir, 'module.js');
  const logical = path.join(link, 'lib', 'module.js');
  const controlFile = path.join(control, 'control.js');
  const ready = path.join(control, 'ready.js');
  const shallowMarker = path.join(control, 'ready-shallow.js');
  const missing = path.join(src, 'generated', 'missing.js');
  oldFile(physical);
  oldFile(controlFile);
  fs.writeFileSync(ready, 'registration marker');
  fs.writeFileSync(shallowMarker, 'shallow registration');
  const h = startWatcher(binding, root, { followSymlinks });
  try {
    h.watch([[shallowMarker, controlFile], []], [[src], []]);
    await waitFor(() => h.changed.has(shallowMarker), 'shallow registration');
    h.watch([[ready], [shallowMarker]], empty, [[missing], []]);
    await waitFor(() => h.changed.has(ready), 'recursive registration');
    const targetWatched = kernelWatches(targetDir);
    await delay(100);
    h.changed.clear();
    h.raw.clear();
    fs.writeFileSync(physical, 'edited after registration');
    fs.writeFileSync(controlFile, 'independent edit');
    await waitFor(
      () => h.changed.has(controlFile),
      'the independent live edit',
    );
    if (!h.raw.has(logical) || !h.changed.has(src)) await delay(350);
    return {
      targetWatched,
      logicalFileEvent: h.raw.has(logical),
      contextEvent: h.changed.has(src),
      controlEvent: h.changed.has(controlFile),
      errors: h.errors,
    };
  } finally {
    await h.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
if (process.argv[2] === '--worker') {
  console.log(
    JSON.stringify(await observe(process.argv[3], process.argv[4] !== 'false')),
  );
} else {
  for (const followSymlinks of [false, true]) {
    const base = runWorker(
      process.argv[2] ?? path.join('base', binary),
      String(followSymlinks),
    );
    const head = runWorker(
      process.argv[3] ?? path.join('head', binary),
      String(followSymlinks),
    );
    console.log(JSON.stringify({ followSymlinks, base, head }));
    for (const result of [base, head]) {
      assert.ok(result.controlEvent);
      assert.deepEqual(result.errors, []);
    }
    for (const key of ['targetWatched', 'logicalFileEvent', 'contextEvent']) {
      assert.equal(base[key], followSymlinks);
      assert.equal(head[key], false);
    }
  }
}
