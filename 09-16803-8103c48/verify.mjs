import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sizes = [1000, 2000, 4000];
const empty = [[], []];
function watchCount() {
  let count = 0;
  for (const fd of fs.readdirSync('/proc/self/fdinfo')) {
    try {
      count +=
        fs.readFileSync('/proc/self/fdinfo/' + fd, 'utf8').match(/^inotify /gm)?.length ?? 0;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return count;
}
async function measure(NativeWatcher, size) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-bulk-'));
  const fence = path.join(root, 'ignored-fence');
  const files = [];
  const missing = [];
  const old = new Date(Date.now() - 60000);
  for (let i = 0; i < size; ++i) {
    const dir = path.join(root, 'p' + i);
    fs.mkdirSync(dir);
    const file = path.join(dir, 'entry.js');
    fs.writeFileSync(file, 'module.exports = 1');
    fs.utimesSync(file, old, old);
    files.push(file);
    missing.push(path.join(dir, 'generated', 'entry.js'));
  }
  // The ignored marker runs on the owner thread after all earlier watch requests.
  let started;
  const watcher = new NativeWatcher({
    aggregateTimeout: 10,
    ignored(file) {
      if (file !== fence) return false;
      started();
      return true;
    },
  });
  const errors = [];
  function watch(f, m) {
    watcher.watch(
      f,
      empty,
      m,
      BigInt(Date.now()),
      (err) => {
        if (err) errors.push(err.message);
      },
      () => {},
    );
  }
  function checkpoint() {
    return new Promise((resolve) => {
      started = resolve;
      watch([[fence], []], empty);
    });
  }
  try {
    watch([files, []], [missing, []]);
    await checkpoint();
    await checkpoint();
    assert.equal(watchCount(), size);
    const samplesMs = [];
    for (let run = 0; run < 5; ++run) {
      if (run) {
        watch(empty, [missing, []]);
        await checkpoint();
        await checkpoint();
      }
      const start = performance.now();
      watch(empty, [[], missing]);
      await checkpoint();
      samplesMs.push(Number((performance.now() - start).toFixed(2)));
      assert.equal(watchCount(), size);
    }
    assert.deepEqual(errors, []);
    const sorted = [...samplesMs].sort((a, b) => a - b);
    return { size, samplesMs, medianMs: sorted[2] };
  } finally {
    await watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
assert.equal(process.platform, 'linux', 'Run on Linux with inotify');
if (process.argv[2] === '--worker') {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(process.argv[3]));
  const output = [];
  for (const size of sizes) output.push(await measure(NativeWatcher, size));
  console.log(JSON.stringify(output));
} else {
  const script = fileURLToPath(import.meta.url);
  const binary = 'rspack.linux-x64-gnu.node';
  function run(binding) {
    const child = spawnSync(process.execPath, [script, '--worker', binding], {
      encoding: 'utf8',
      timeout: 240000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }));
  assert.ok(head.at(-1).medianMs > 3 * base.at(-1).medianMs);
  assert.ok(head.at(-1).medianMs > 2.5 * head.at(-2).medianMs);
}
