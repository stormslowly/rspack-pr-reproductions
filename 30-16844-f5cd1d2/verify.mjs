import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function until(check, description) {
  const deadline = performance.now() + 8000;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error('Timed out waiting for ' + description);
    await delay(5);
  }
}

async function observe(binding, preserveMtime) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-restored-directory-'));
  const context = path.join(tmp, 'src');
  const parent = path.join(context, 'pages');
  const missing = path.join(parent, 'restored');
  const fence = path.join(tmp, 'control', 'fence.js');
  const old = 1600000000.123;
  const changes = new Set();
  const watcher = new NativeWatcher({ aggregateTimeout: 10 });
  try {
    fs.mkdirSync(parent, { recursive: true });
    fs.mkdirSync(path.dirname(fence));
    fs.writeFileSync(fence, '');
    fs.utimesSync(fence, old, old);
    fs.utimesSync(context, old, old);
    await delay(60);
    const startTime = Date.now();
    assert.equal(fs.existsSync(missing), false);
    await delay(20);
    fs.mkdirSync(missing);
    if (preserveMtime) fs.utimesSync(missing, old, old);
    const stat = fs.statSync(missing);
    assert.ok(stat.birthtimeMs >= startTime, 'the directory must have a new birth time');
    assert.equal(stat.mtimeMs < startTime, preserveMtime);
    watcher.watch([[fence], []], [[context], []], [[missing], []], BigInt(startTime),
      (error, batch) => {
        assert.ifError(error);
        for (const name of batch.changedFiles) changes.add(name);
      }, () => {});
    await until(() => changes.has(context), 'the initial context change');
    fs.writeFileSync(fence, 'flush');
    await until(() => changes.has(fence), 'a later independent file change');
    return { contextChanged: changes.has(context), missingDirectoryChanged: changes.has(missing) };
  } finally {
    await watcher.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3], process.argv[4] !== 'current')));
} else {
  const binary = 'rspack.linux-x64-gnu.node';
  const baseBinding = process.argv[2] ?? path.join('base', binary);
  const prBinding = process.argv[3] ?? path.join('head', binary);
  function run(binding, mode) {
    const result = spawnSync(process.execPath,
      [fileURLToPath(import.meta.url), '--worker', binding, mode],
      { encoding: 'utf8', timeout: 20000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  const base = run(baseBinding, 'preserved');
  const head = run(prBinding, 'preserved');
  const headCurrentMtime = run(prBinding, 'current');
  console.log(JSON.stringify({ base, head, headCurrentMtime }));
  assert.deepEqual(base, { contextChanged: true, missingDirectoryChanged: true });
  assert.deepEqual(head, { contextChanged: true, missingDirectoryChanged: false });
  assert.deepEqual(headCurrentMtime, base);
}
