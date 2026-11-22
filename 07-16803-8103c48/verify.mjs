import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const empty = [[], []];

function kernelWatches(dir) {
  const inode = fs.statSync(dir, { bigint: true }).ino.toString(16);
  for (const fd of fs.readdirSync('/proc/self/fdinfo')) {
    try {
      const info = fs.readFileSync('/proc/self/fdinfo/' + fd, 'utf8');
      if (
        info
          .split('\n')
          .some((line) => line.startsWith('inotify ') && line.includes(' ino:' + inode + ' '))
      )
        return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

async function waitFor(ready, what) {
  const deadline = performance.now() + 5000;
  while (!ready()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for ' + what);
    await delay(10);
  }
}

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-16803-'));
  const src = path.join(fixture, 'src');
  const controlDir = path.join(fixture, 'control');
  fs.mkdirSync(controlDir);
  const control = path.join(controlDir, 'control.js');
  const first = path.join(controlDir, 'first.js');
  const second = path.join(controlDir, 'second.js');
  const old = new Date(Date.now() - 120000);
  function oldFile(file) {
    fs.writeFileSync(file, 'original');
    fs.utimesSync(file, old, old);
  }
  oldFile(control);
  fs.writeFileSync(first, 'ready');
  fs.writeFileSync(second, 'ready');
  const sub = path.join(src, 'sub');
  const deep = path.join(sub, 'deep');
  const firstFile = path.join(deep, 'before.js');
  const target = path.join(deep, 'after.js');
  const direct = path.join(sub, 'index.js');
  const outerMissing = path.join(src, 'absent', 'entry.js');
  const innerMissing = path.join(sub, 'absent', 'entry.js');
  fs.mkdirSync(deep, { recursive: true });
  for (const file of [direct, firstFile, target]) oldFile(file);
  const watcher = new NativeWatcher({ aggregateTimeout: 10 });
  const changed = new Set();
  const raw = new Set();
  const errors = [];
  function watch(files, dirs, missing) {
    watcher.watch(
      files,
      dirs,
      missing,
      BigInt(Date.now() - 10000),
      (error, result) => {
        if (error) errors.push(error.message.replaceAll(fixture, '<fixture>'));
        else for (const file of result.changedFiles) changed.add(file);
      },
      (event) => raw.add(event.path),
    );
  }
  try {
    watch([[control, first, direct], []], [[src], []], [[outerMissing, innerMissing], []]);
    await waitFor(() => changed.has(first), 'the initial scan');
    assert.ok(kernelWatches(src) && kernelWatches(sub) && kernelWatches(deep));
    fs.writeFileSync(firstFile, 'first live edit');
    await waitFor(() => raw.has(firstFile) && changed.has(src), 'the initial context edit');

    watch([[second], [first]], empty, [[], [innerMissing]]);
    await waitFor(() => changed.has(second), 'the completed downgrade');
    changed.clear();
    raw.clear();
    const outerWatch = kernelWatches(src);
    const childWatch = kernelWatches(sub);
    const deepWatch = kernelWatches(deep);
    fs.writeFileSync(target, 'second live edit');
    fs.writeFileSync(control, 'control edit');
    await waitFor(() => changed.has(control), 'the independent live control');
    if (!raw.has(target) || !changed.has(src)) await delay(1000);
    return {
      outerWatch,
      childWatch,
      deepWatch,
      fileEvent: raw.has(target),
      contextEvent: changed.has(src),
      controlEvent: changed.has(control),
      errors,
    };
  } finally {
    await watcher.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux', 'Run with Linux inotify');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  const binary = 'rspack.linux-x64-gnu.node';
  const script = fileURLToPath(import.meta.url);
  function run(binding) {
    const child = spawnSync(process.execPath, [script, '--worker', binding], {
      encoding: 'utf8',
      timeout: 30000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }));
  for (const result of [base, head]) {
    assert.ok(result.outerWatch && result.childWatch && result.controlEvent);
    assert.deepEqual(result.errors, []);
  }
  assert.ok(base.deepWatch && base.fileEvent && base.contextEvent);
  assert.equal(head.deepWatch, false);
  assert.equal(head.fileEvent, false);
  assert.equal(head.contextEvent, false);
}
