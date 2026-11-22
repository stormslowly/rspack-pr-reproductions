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

async function observe(binding, limitWatches) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rspack-recursive-retry-'),
  );
  const src = path.join(root, 'src');
  const good = path.join(src, 'good');
  const control = path.join(root, 'control');
  const unreadable = path.join(src, 'incoming');
  for (const dir of [src, good, control]) fs.mkdirSync(dir);
  const source = path.join(good, 'entry.js');
  const control1 = path.join(control, 'first.js');
  const control2 = path.join(control, 'second.js');
  const ready = [0, 1, 2].map((i) => path.join(control, 'ready-' + i + '.js'));
  for (const file of [source, control1, control2]) oldFile(file);
  for (const file of ready) fs.writeFileSync(file, 'registration marker');
  const missing = path.join(src, 'generated', 'entry.js');
  const shallowMarker = path.join(control, 'ready-shallow.js');
  fs.writeFileSync(shallowMarker, 'shallow registration');
  const h = startWatcher(binding, root);
  try {
    h.watch([[shallowMarker, control1, control2], []], [[src], []]);
    await waitFor(
      () => h.changed.has(shallowMarker),
      'the shallow registration',
    );
    h.watch([[ready[0]], [shallowMarker]], empty, [[missing], []]);
    await waitFor(() => h.changed.has(ready[0]), 'the recursive upgrade');
    assert.ok(kernelWatches(src) && kernelWatches(good));
    fs.mkdirSync(unreadable, { mode: limitWatches ? 0o755 : 0o111 });
    if (!limitWatches)
      assert.throws(
        () => fs.readdirSync(unreadable),
        { code: 'EACCES' },
        'run as an unprivileged user',
      );
    fs.writeFileSync(control1, 'signal after the new directory was created');
    await waitFor(
      () => h.changed.has(control1),
      'the independent control after directory creation',
    );
    h.watch([[ready[1]], []]);
    await waitFor(
      () => h.errors.length || h.changed.has(ready[1]),
      'the follow-up registration',
    );
    const errorsDuringRetry = h.errors.slice();
    const goodAfterRetry = kernelWatches(good);
    if (limitWatches)
      fs.writeFileSync('/proc/sys/user/max_inotify_watches', '8\n');
    else fs.chmodSync(unreadable, 0o755);
    h.watch([[ready[2]], []]);
    await waitFor(
      () => h.changed.has(ready[2]),
      'successful registration after clearing the error',
    );
    await delay(100);
    h.raw.clear();
    h.changed.clear();
    fs.writeFileSync(source, 'edited after clearing the error');
    fs.writeFileSync(control2, 'independent edit');
    await waitFor(
      () => h.changed.has(control2),
      'the final independent control',
    );
    if (!h.raw.has(source) || !h.changed.has(src)) await delay(350);
    return {
      errorsDuringRetry,
      goodAfterRetry,
      rootAfterRecovery: kernelWatches(src),
      goodAfterRecovery: kernelWatches(good),
      fileEvent: h.raw.has(source),
      contextEvent: h.changed.has(src),
      controlEvent: h.changed.has(control2),
      errors: h.errors,
    };
  } finally {
    if (fs.existsSync(unreadable)) fs.chmodSync(unreadable, 0o755);
    await h.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--worker') {
  const limitWatches = process.argv[4] === 'quota';
  if (limitWatches) {
    assert.ok(process.argv[5]);
    assert.notEqual(
      fs.readlinkSync('/proc/self/ns/user'),
      process.argv[5],
      'use a private user namespace',
    );
    fs.writeFileSync('/proc/sys/user/max_inotify_watches', '3\n');
  }
  console.log(JSON.stringify(await observe(process.argv[3], limitWatches)));
} else {
  function run(binding, scenario) {
    if (scenario === 'permission') return runWorker(binding, scenario);
    const outerNamespace = fs.readlinkSync('/proc/self/ns/user');
    const result = spawnSync(
      'unshare',
      [
        '-Urmpf',
        '--mount-proc',
        process.execPath,
        script,
        '--worker',
        path.resolve(binding),
        scenario,
        outerNamespace,
      ],
      { encoding: 'utf8', timeout: 60000 },
    );
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  for (const scenario of ['permission', 'quota']) {
    const base = run(process.argv[2] ?? path.join('base', binary), scenario);
    const head = run(process.argv[3] ?? path.join('head', binary), scenario);
    console.log(JSON.stringify({ scenario, base, head }));
    assert.ok(base.controlEvent && head.controlEvent);
    assert.deepEqual(base.errors, []);
    assert.ok(
      base.goodAfterRetry &&
        base.rootAfterRecovery &&
        base.goodAfterRecovery &&
        base.fileEvent &&
        base.contextEvent,
    );
    assert.equal(head.errorsDuringRetry.length, 1);
    assert.match(
      head.errorsDuringRetry[0],
      scenario === 'quota' ? /watch limit/i : /permission denied/i,
    );
    assert.deepEqual(head.errors, head.errorsDuringRetry);
    for (const key of [
      'goodAfterRetry',
      'rootAfterRecovery',
      'goodAfterRecovery',
      'fileEvent',
      'contextEvent',
    ])
      assert.equal(head[key], false);
  }
}
