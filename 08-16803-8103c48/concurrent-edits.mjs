import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-16803-gap-'));
  const src = path.join(root, 'src');
  const external = path.join(root, 'external');
  fs.mkdirSync(src);
  fs.mkdirSync(external);
  for (let i = 0; i < 8000; ++i) fs.mkdirSync(path.join(src, 'dir-' + i));
  const files = Array.from({ length: 100 }, (_, i) => path.join(src, 'file-' + i + '.js'));
  const after = path.join(src, 'after.js');
  const old = new Date(Date.now() - 120000);
  for (const file of [...files, after]) {
    fs.writeFileSync(file, 'old');
    fs.utimesSync(file, old, old);
  }
  const first = path.join(external, 'first');
  const second = path.join(external, 'second');
  const gate = path.join(external, 'ignored-gate');
  const missing = path.join(src, 'unresolved', 'index.js');
  fs.writeFileSync(first, 'one');
  fs.writeFileSync(second, 'two');
  const empty = [[], []];
  const changed = new Set();
  const errors = [];
  let writer;
  let began;
  const startWriting = new Promise((resolve) => {
    began = resolve;
  });
  const watcher = new NativeWatcher({
    aggregateTimeout: 10,
    ignored(file) {
      if (file !== gate) return false;
      if (!writer) {
        writer = (async () => {
          began();
          for (let i = 0; i < files.length; i += 2) {
            await delay(1);
            fs.writeFileSync(files[i], 'during registration');
            fs.writeFileSync(files[i + 1], 'during registration');
          }
        })();
      }
      return true;
    },
  });
  function watch(f, m) {
    watcher.watch(
      f,
      empty,
      m,
      BigInt(Date.now() - 10000),
      (err, data) => {
        if (err) errors.push(err.message);
        else for (const file of data.changedFiles) changed.add(file);
      },
      () => {},
    );
  }
  async function until(pred) {
    const deadline = Date.now() + 15000;
    while (!pred()) {
      if (Date.now() > deadline) throw Error('timed out');
      await delay(10);
    }
  }
  try {
    watch([[...files, after, first], []], [[missing], []]);
    await until(() => changed.has(first));
    assert.equal(files.filter((f) => changed.has(f)).length, 0);
    watch([[gate, second], [first]], [[], [missing]]);
    await startWriting;
    await writer;
    await until(() => changed.has(second));
    fs.writeFileSync(after, 'after registration');
    await until(() => changed.has(after));
    await delay(800);
    const missingEdits = files.filter((f) => !changed.has(f)).map((f) => path.basename(f));
    return {
      written: files.length,
      delivered: files.length - missingEdits.length,
      missed: missingEdits,
      afterDelivered: changed.has(after),
      errors,
    };
  } finally {
    await watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux', 'Run with Linux inotify');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  const binary = 'rspack.linux-x64-gnu.node';
  const script = fileURLToPath(import.meta.url);
  function run(binding) {
    const child = spawnSync(process.execPath, [script, '--worker', binding], {
      encoding: 'utf8',
      timeout: 60000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }));
  assert.equal(base.delivered, base.written);
  assert.ok(head.delivered < head.written, 'No edit overlapped the watch gap in this run');
  for (const result of [base, head]) {
    assert.equal(result.afterDelivered, true);
    assert.deepEqual(result.errors, []);
  }
}
