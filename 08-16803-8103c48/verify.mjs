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
  assert.notEqual(process.getuid(), 0, 'Use an unprivileged user for the EACCES transition');
  fs.mkdirSync(src);
  const target = path.join(src, 'entry.js');
  const missing = path.join(src, 'unresolved', 'module.js');
  oldFile(target);
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
    watch([[control, first, target], []], empty, [[missing], []]);
    await waitFor(() => changed.has(first), 'the initial scan');
    assert.ok(kernelWatches(src));

    // A searchable directory still permits writes to an existing writable file by name.
    fs.chmodSync(src, 0o111);
    watch([[second], [first]], empty, [[], [missing]]);
    await waitFor(() => errors.length > 0 || changed.has(second), 'the downgrade result');
    const targetWatch = kernelWatches(src);
    changed.clear();
    raw.clear();
    fs.writeFileSync(target, 'still writable');
    fs.writeFileSync(control, 'control edit');
    await waitFor(() => changed.has(control), 'the independent live control');
    if (!changed.has(target)) await delay(1000);
    return {
      targetWatch,
      fileEvent: raw.has(target),
      aggregateEvent: changed.has(target),
      controlEvent: changed.has(control),
      errors,
    };
  } finally {
    fs.chmodSync(src, 0o755);
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
  assert.ok(base.controlEvent && head.controlEvent);
  assert.ok(base.targetWatch && base.fileEvent && base.aggregateEvent);
  assert.deepEqual(base.errors, []);
  assert.equal(head.targetWatch, false);
  assert.equal(head.fileEvent, false);
  assert.equal(head.aggregateEvent, false);
  assert.equal(head.errors.length, 1);
  assert.match(head.errors[0], /permission denied/i);
}
