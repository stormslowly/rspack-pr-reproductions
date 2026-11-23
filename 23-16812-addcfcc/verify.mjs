import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function measure(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-rewatch-')));
  const dir = path.join(root, 'packages', 'app', 'src');
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(root, 'ignored-checkpoint');
  let checkpointReached;
  const watcher = new NativeWatcher({
    ignored(file) {
      if (file !== marker) return false;
      checkpointReached();
      return true;
    }
  });
  const empty = [[], []];
  function watch(files = empty, missing = empty) {
    watcher.watch(files, empty, missing, BigInt(Date.now()), error => {
      assert.ifError(error);
    }, () => {});
  }
  function checkpoint() {
    return new Promise(resolve => {
      checkpointReached = resolve;
      watch([[marker], []]);
    });
  }

  const results = [];
  const rounds = 6;
  let previousCount = 0;
  try {
    for (const count of [1_000, 20_000, 50_000]) {
      const added = [];
      for (let i = previousCount; i < count; i++) {
        added.push(path.join(dir, 'module-' + i, 'index.js'));
      }
      watch(empty, [added, []]);
      await checkpoint();
      await delay(500);
      await checkpoint();

      // Consecutive checkpoints bracket exactly 'rounds' native registrations.
      // The ignored checkpoint itself leaves the dependency sets untouched.
      const samples = [];
      for (let sample = 0; sample < 5; sample++) {
        const start = performance.now();
        for (let i = 1; i < rounds; i++) watch();
        await checkpoint();
        samples.push(Number(((performance.now() - start) / rounds).toFixed(3)));
      }
      const medianMs = [...samples].sort((a, b) => a - b)[2];
      results.push({ count, medianMs, samplesMs: samples });
      previousCount = count;
    }
    return results;
  } finally {
    await watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'darwin');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await measure(process.argv[3])));
} else {
  function run(binding) {
    const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding],
      { encoding: 'utf8', timeout: 180_000 });
    if (worker.error) throw worker.error;
    assert.equal(worker.status, 0, worker.stderr || worker.stdout);
    return JSON.parse(worker.stdout);
  }
  const binary = 'rspack.darwin-arm64.node';
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }));
  assert.ok(head.at(-1).medianMs > 5 * base.at(-1).medianMs);
  assert.ok(head.at(-1).medianMs > 5 * head[0].medianMs);
}
