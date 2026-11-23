import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function observe(NativeWatcher, aliasFirst) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-file-refs-')));
  const target = path.join(root, 'real', 'entry.js');
  const alias = path.join(root, 'app', 'alias.js');
  const control = path.join(root, 'independent', 'control.js');
  const marker = path.join(root, 'registration-checkpoint');
  for (const file of [target, alias, control]) fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(target, 'before');
  fs.writeFileSync(control, 'before');
  fs.symlinkSync(target, alias);

  let checkpointReached;
  const changed = new Set();
  const watcher = new NativeWatcher({
    aggregateTimeout: 20,
    followSymlinks: true,
    ignored(file) {
      if (file !== marker) return false;
      checkpointReached();
      return true;
    }
  });
  function watch(added, removed) {
    watcher.watch([added, removed], [[], []], [[], []], BigInt(Date.now() + 60_000),
      (error, batch) => {
        assert.ifError(error);
        for (const file of batch.changedFiles) changed.add(file);
      }, () => {});
  }
  // The owner processes calls in order. Reaching this ignored marker means the
  // preceding registration has been applied without introducing another watch.
  function checkpoint() {
    return new Promise(resolve => {
      checkpointReached = resolve;
      watch([marker], []);
    });
  }

  try {
    const [first, second] = aliasFirst ? [alias, target] : [target, alias];
    watch([first, control], []);
    await checkpoint();
    watch([second], []);
    await checkpoint();
    watch([], [alias]);
    await checkpoint();
    await delay(400);
    changed.clear();

    fs.writeFileSync(target, 'live target edit');
    fs.writeFileSync(control, 'independent live edit');
    const deadline = Date.now() + 2200;
    while (Date.now() < deadline && !(changed.has(control) && changed.has(target))) {
      await delay(25);
    }
    assert.ok(changed.has(control), 'The independent edit must reach the aggregate callback');
    return changed.has(target);
  } finally {
    await watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--mapping') {
  const source = path.resolve(process.argv[3] ?? 'source');
  const installed = path.join(source, 'crates/rspack_watcher/examples/review_link_refs.rs');
  assert.equal(fs.readFileSync(installed, 'utf8'), fs.readFileSync(new URL('./mapping.rs', import.meta.url), 'utf8'));
  const probe = spawnSync('cargo', ['run', '--locked', '--quiet', '-p', 'rspack_watcher',
    '--example', 'review_link_refs'], { cwd: source, encoding: 'utf8' });
  if (probe.error) throw probe.error;
  assert.equal(probe.status, 0, probe.stderr);
  process.stdout.write(probe.stdout);
  assert.deepEqual(probe.stdout.trim().split(/\r?\n/), [
    'alias_first=false refs_before=2 target_watched_after=true',
    'alias_first=true refs_before=1 target_watched_after=false'
  ]);
} else if (process.argv[2] === '--worker') {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(process.argv[3]));
  console.log(JSON.stringify({
    targetFirst: await observe(NativeWatcher, false),
    aliasFirst: await observe(NativeWatcher, true)
  }));
} else {
  assert.equal(process.platform, 'darwin');
  function run(binding) {
    const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding],
      { encoding: 'utf8', timeout: 30_000 });
    if (worker.error) throw worker.error;
    assert.equal(worker.status, 0, worker.stderr || worker.stdout);
    return JSON.parse(worker.stdout);
  }
  const binary = 'rspack.darwin-arm64.node';
  const base = run(process.argv[2] ?? path.join('base', binary));
  const foundation = run(process.argv[3] ?? path.join('head', binary));
  const integrated = run(process.argv[4] ?? path.join('wired', binary));
  console.log(JSON.stringify({ base, foundation, integrated }));
  assert.deepEqual(base, { targetFirst: true, aliasFirst: true });
  assert.deepEqual(foundation, base);
  assert.deepEqual(integrated, { targetFirst: true, aliasFirst: false });
}
