import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function waitFor(test, label) {
  const deadline = performance.now() + 6000;
  while (!test()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for ' + label);
    await delay(20);
  }
}

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-context-')));
  const onlyDir = path.join(root, 'existing');
  fs.mkdirSync(onlyDir);
  const initial = path.join(onlyDir, 'initial.js');
  fs.writeFileSync(initial, 'initial scan');
  const sibling = path.join(root, 'new.js');
  const watcher = new NativeWatcher({ aggregateTimeout: 20 });
  const raw = new Set();
  const changed = new Set();
  try {
    watcher.watch([[], []], [[root], []], [[], []], BigInt(Date.now() - 5000),
      (error, batch) => {
        assert.ifError(error);
        for (const file of batch.changedFiles) changed.add(file);
      }, (event) => raw.add(event.path));
    await waitFor(() => raw.has(initial) && changed.has(root), 'the initial context scan');
    await delay(300);
    raw.clear();
    changed.clear();
    fs.writeFileSync(sibling, 'new root entry');
    await delay(1500);
    const rootInvalidated = changed.has(root);
    const control = path.join(onlyDir, 'control.js');
    fs.writeFileSync(control, 'independent live edit');
    await waitFor(() => raw.has(control), 'the known child directory');
    return { siblingEvent: raw.has(sibling), rootInvalidated, childEvent: raw.has(control) };
  } finally {
    await watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'darwin');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  function run(binding) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding],
      { encoding: 'utf8', timeout: 20000 });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const binary = 'rspack.darwin-arm64.node';
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }));
  assert.deepEqual(base, { siblingEvent: true, rootInvalidated: true, childEvent: true });
  assert.deepEqual(head, { siblingEvent: false, rootInvalidated: false, childEvent: true });
}
