import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const tempTarget = fs.realpathSync('/tmp');
  assert.notEqual(tempTarget, '/tmp', 'This case uses the macOS /tmp symlink');
  const temp = fs.realpathSync(os.tmpdir());
  const otherParent = temp === tempTarget || temp.startsWith(tempTarget + '/') ? os.homedir() : temp;
  const project = fs.mkdtempSync('/tmp/rspack-watch-root-');
  const unrelated = fs.realpathSync(fs.mkdtempSync(path.join(otherParent, 'rspack-unrelated-')));
  assert.ok(!unrelated.startsWith(tempTarget + '/'), 'The sibling files must live outside /private/tmp');
  const logical = path.join(project, 'entry.js');
  fs.writeFileSync(logical, 'before');
  const physical = fs.realpathSync(logical);
  const probes = new Set(Array.from({ length: 16 }, (_, n) => path.join(unrelated, n + '.js')));
  const seen = new Set();
  const initial = new Set();
  const watcher = new NativeWatcher({
    aggregateTimeout: 20,
    ignored(file) {
      if (file === physical || probes.has(file)) seen.add(file);
      return file !== logical;
    }
  });
  try {
    watcher.watch([[logical], []], [[], []], [[], []], BigInt(Date.now() - 5_000),
      (error, batch) => {
        assert.ifError(error);
        for (const file of batch.changedFiles) initial.add(file);
      }, () => {});
    const deadline = Date.now() + 6_000;
    while (!initial.has(logical) && Date.now() < deadline) await delay(20);
    assert.ok(initial.has(logical), 'Initial scan did not report the registered file');
    await delay(300);
    seen.clear();

    fs.writeFileSync(logical, 'live edit');
    for (const file of probes) fs.writeFileSync(file, 'outside the project');
    await delay(2_400);
    assert.ok(seen.has(physical), 'The live control write must reach the native event filter');
    return [...probes].filter(file => seen.has(file)).length;
  } finally {
    await watcher.close();
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(unrelated, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'darwin');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  function run(binding) {
    const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding],
      { encoding: 'utf8', timeout: 20_000 });
    if (worker.error) throw worker.error;
    assert.equal(worker.status, 0, worker.stderr || worker.stdout);
    return JSON.parse(worker.stdout);
  }
  const binary = 'rspack.darwin-arm64.node';
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ unrelatedFiles: 16, base, head }));
  assert.equal(base, 0);
  assert.equal(head, 16);
}
