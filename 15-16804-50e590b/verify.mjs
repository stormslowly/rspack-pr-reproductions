import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

function watchCount() {
  let total = 0;
  for (const fd of fs.readdirSync('/proc/self/fdinfo')) {
    try {
      const data = fs.readFileSync('/proc/self/fdinfo/' + fd, 'utf8');
      total += data.match(/^inotify /gm)?.length ?? 0;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return total;
}

async function measure(NativeWatcher, size) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-subtree-'));
  const root = path.join(temp, 'context');
  const tree = path.join(root, 'generated');
  const outside = path.join(temp, 'outside');
  const ready = path.join(temp, 'control', 'ready.js');
  fs.mkdirSync(tree, { recursive: true });
  fs.mkdirSync(path.dirname(ready));
  for (let i = 0; i < size; i++) fs.mkdirSync(path.join(tree, 'd' + i));
  const registered = [];
  const removal = [];
  let watched;
  try {
    await delay(2200);
    for (let i = 0; i < 3; i++) {
      const watcher = new NativeWatcher({ aggregateTimeout: 20 });
      const readyEvent = Promise.withResolvers();
      const treeEvent = Promise.withResolvers();
      try {
        const startTime = Date.now();
        fs.writeFileSync(ready, 'marker' + i);
        const start = performance.now();
        watcher.watch([[ready], []], [[root], []], [[path.join(root, 'absent', 'index.js')], []],
          BigInt(startTime),
          (error) => { if (error) throw error; },
          (event) => {
            if (event.path === ready) readyEvent.resolve();
            if (event.path === tree && !fs.existsSync(tree)) treeEvent.resolve();
          });
        await readyEvent.promise;
        registered.push(+(performance.now() - start).toFixed(2));
        watched = watchCount();
        assert.equal(watched, size + 3);
        const beforeRename = performance.now();
        fs.renameSync(tree, outside);
        await treeEvent.promise;
        removal.push(+(performance.now() - beforeRename).toFixed(2));
      } finally {
        await watcher.close();
        if (fs.existsSync(outside)) fs.renameSync(outside, tree);
      }
    }
    return { size, watched, registrationMs: registered, removalMs: removal };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
assert.equal(process.platform, 'linux');
if (process.argv[2] === '--worker') {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(process.argv[3]));
  const output = [];
  for (const size of [4000, 8000, 16000]) output.push(await measure(NativeWatcher, size));
  console.log(JSON.stringify(output));
} else {
  const binary = 'rspack.linux-x64-gnu.node';
  function run(binding) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding],
      { encoding: 'utf8', timeout: 150000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }));
  const median = (values) => [...values].sort((a, b) => a - b)[1];
  assert.ok(median(head.at(-1).removalMs) > 3 * median(base.at(-1).removalMs),
    'Expected a material increase in subtree removal latency on the reviewed build');
}
