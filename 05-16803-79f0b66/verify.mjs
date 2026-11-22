import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const binary = 'rspack.linux-x64-gnu.node';
const empty = [[], []];

function childResult(command, args) {
  const run = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stderr || run.stdout || 'Child exited without a result');
  return JSON.parse(run.stdout);
}

async function until(ready, description) {
  const deadline = performance.now() + 5000;
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error('Timed out waiting for ' + description);
    await delay(10);
  }
}

function kernelWatches(directory) {
  const ino = fs.statSync(directory, { bigint: true }).ino.toString(16);
  for (const entry of fs.readdirSync('/proc/self/fdinfo')) {
    let info;
    try {
      info = fs.readFileSync('/proc/self/fdinfo/' + entry, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (info.split('\n').some(line => line.startsWith('inotify ') && line.includes(' ino:' + ino + ' '))) return true;
  }
  return false;
}

async function probe(binding, scenario) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-16803-'));
  const src = path.join(fixture, 'src');
  const controlDir = path.join(fixture, 'control');
  const targetDir = src;
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(controlDir);
  const target = path.join(targetDir, 'entry.js');
  const control = path.join(controlDir, 'control.js');
  const first = path.join(controlDir, 'ready-1.js');
  const second = path.join(controlDir, 'ready-2.js');
  const old = new Date(Date.now() - 120000);
  function makeSource(file) {
    fs.writeFileSync(file, 'before');
    fs.utimesSync(file, old, old);
  }
  makeSource(target);
  makeSource(control);
  fs.writeFileSync(first, 'ready');
  fs.writeFileSync(second, 'ready');
  const previous = path.join(fixture, 'previous');
  fs.mkdirSync(previous);
  const previousFile = path.join(previous, 'old.js');
  makeSource(previousFile);
  const watcher = new NativeWatcher({ aggregateTimeout: 10 });
  const changed = new Set();
  const errors = [];
  function watch(files, missing = empty) {
    watcher.watch(files, empty, missing, BigInt(Date.now() - 10000), (error, result) => {
      if (error) errors.push(String(error.message).replaceAll(fixture, '<fixture>'));
      else for (const file of result.changedFiles) changed.add(file);
    }, () => {});
  }

  try {
    watch([[control, first, previousFile], []]);
    await until(() => changed.has(first), 'the initial two watches');
    assert.ok(kernelWatches(previous) && kernelWatches(controlDir));

    watch([[target, second], [previousFile, first]]);
    await until(() => errors.length || changed.has(second), 'the replacement result');
    watch(empty);
    if (errors.length) {
      await until(() => errors.length > 1 || changed.has(second), 'the empty retry result');
    }
    const targetWatched = kernelWatches(targetDir);
    changed.clear();
    fs.writeFileSync(target, 'after');
    fs.writeFileSync(control, 'after');
    await until(() => changed.has(control), 'an edit in the independent control directory');
    if (!changed.has(target)) await delay(800);
    return { targetWatched, targetDelivered: changed.has(target), controlDelivered: changed.has(control), errors, obsoleteStillWatched: kernelWatches(previous) };
  } finally {
    await watcher.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux', 'Use Linux with inotify');
if (process.argv[2] === '--worker') {
  assert.notEqual(fs.readlinkSync('/proc/self/ns/user'), process.argv[5], 'a private user namespace is required');
  fs.writeFileSync('/proc/sys/user/max_inotify_watches', '2\n');
    console.log(JSON.stringify(await probe(process.argv[3], process.argv[4])));
} else {
  const controlBinary = path.resolve(process.argv[2] ?? path.join('base', binary));
  const reviewedBinary = path.resolve(process.argv[3] ?? path.join('head', binary));
  function run(binding, scenario) {
    const parentNamespace = fs.readlinkSync('/proc/self/ns/user');
    return childResult('unshare', ['-Urmpf', '--mount-proc', process.execPath, script, '--worker', binding, scenario, parentNamespace]);
  }
  for (const scenario of ["replace-at-quota"]) {
    const base = run(controlBinary, scenario);
    const head = run(reviewedBinary, scenario);
    console.log(JSON.stringify({ scenario, base, head }));
    assert.equal(base.controlDelivered, true);
    assert.equal(head.controlDelivered, true);
    assert.equal(base.targetWatched, true);
    assert.equal(head.targetWatched, false);
    assert.equal(base.targetDelivered, true);
    assert.equal(head.targetDelivered, false);
    assert.deepEqual(base.errors, []);
    assert.equal(base.obsoleteStillWatched, false);
    assert.equal(head.obsoleteStillWatched, true);
    assert.equal(head.errors.length, 2);
    assert.ok(head.errors.every(message => /watch limit/i.test(message)));
  }
}
