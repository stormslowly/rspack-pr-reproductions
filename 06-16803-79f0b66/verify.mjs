import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const binary = 'rspack.linux-x64-gnu.node';
const empty = [[], []];

function activeWatchCount() {
  let count = 0;
  for (const fd of fs.readdirSync('/proc/self/fdinfo')) {
    try {
      const info = fs.readFileSync('/proc/self/fdinfo/' + fd, 'utf8');
      count += info.match(/^inotify /gm)?.length ?? 0;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return count;
}

async function measure(binding, kind) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-rewatch-'));
  const marker = path.join(root, 'ignored-marker');
  let started;
  // The owner processes watch requests in order. Seeing this ignored path in the
  // next request means the preceding requests have finished, with no watch churn.
  const watcher = new NativeWatcher({
    ignored(file) {
      if (file !== marker) return false;
      started();
      return true;
    },
    aggregateTimeout: 10
  });
  function watch(files = empty, directories = empty, missing = empty) {
    watcher.watch(files, directories, missing, BigInt(Date.now()), error => {
      if (error) throw error;
    }, () => {});
  }
  function checkpoint() {
    return new Promise(resolve => {
      started = resolve;
      watch([[marker], []]);
    });
  }
  const directoryCase = kind === 'directories';
  const counts = directoryCase ? [2000, 4000, 8000] : [10000, 50000];
  const rounds = directoryCase ? 8 : 40;
  const results = [];
  let previous = 0;
  try {
    for (const count of counts) {
      const names = [];
      for (let i = previous; i < count; i++) {
        const file = path.join(root, 'dep-' + i);
        if (directoryCase) fs.mkdirSync(file);
        names.push(file);
      }
      if (directoryCase) watch(empty, [names, []]);
      else watch(empty, empty, [names, []]);
      await checkpoint();
      for (let i = 0; i < 3; i++) await checkpoint();
      const watches = activeWatchCount();
      assert.equal(watches, directoryCase ? count : 1);

      const samples = [];
      for (let sample = 0; sample < 5; sample++) {
        const begin = performance.now();
        for (let i = 1; i < rounds; i++) watch();
        await checkpoint();
        samples.push((performance.now() - begin) / rounds);
      }
      samples.sort((a, b) => a - b);
      results.push({ count, watches, medianMs: Number(samples[2].toFixed(4)), samplesMs: samples.map(n => Number(n.toFixed(4))) });
      previous = count;
    }
    return results;
  } finally {
    await watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux', 'Use Linux with inotify');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await measure(process.argv[3], process.argv[4])));
} else {
  const basePath = path.resolve(process.argv[2] ?? path.join('base', binary));
  const headPath = path.resolve(process.argv[3] ?? path.join('head', binary));
  function run(binding, kind) {
    const result = spawnSync(process.execPath, [script, '--worker', binding, kind], { encoding: 'utf8', timeout: 180000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  for (const kind of ['directories', 'missing']) {
    const base = run(basePath, kind);
    const head = run(headPath, kind);
    console.log(JSON.stringify({ kind, base, head }));
    const lastBase = base.at(-1).medianMs;
    const lastHead = head.at(-1).medianMs;
    assert.ok(lastHead > 2 * lastBase, 'Expected the regression at the largest fixture size');
    if (kind === 'directories') {
      assert.ok(lastHead > 2.5 * head.at(-2).medianMs, 'Expected superlinear growth when doubling the watch count');
    }
  }
}
