import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter, on } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const timestamp = 1600000000123;

async function readSnapshot() {
  const { rspack } = await import('@rspack/core');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-retained-missing-'));
  const root = path.join(tmp, 'src');
  const parent = path.join(root, 'pages');
  const target = path.join(parent, 'restored');
  const staged = path.join(tmp, 'staged');
  const project = path.join(tmp, 'project');
  const entry = path.join(project, 'switch.js');
  const loader = path.join(project, 'deps.cjs');
  const old = timestamp / 1000;
  for (const dir of [parent, staged, project]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(entry, 'off');
  fs.utimesSync(entry, old, old);
  fs.utimesSync(root, old, old);
  fs.writeFileSync(loader, `
module.exports = function (source) {
  this.addMissingDependency(${JSON.stringify(target)});
  if (source === 'on') this.addContextDependency(${JSON.stringify(root)});
  return 'module.exports = 0;';
};
`);
  fs.utimesSync(loader, old, old);

  const compiler = rspack({
    mode: 'development',
    context: project,
    entry: './switch.js',
    devtool: false,
    output: { path: path.join(tmp, 'dist') },
    module: { rules: [{ test: /switch\.js$/, use: loader }] },
    experiments: { nativeWatcher: true },
  });
  let number = 0;
  compiler.hooks.afterCompile.tapPromise('RestoreGeneratedTree', async compilation => {
    if (++number !== 2) return;
    assert.ok(compilation.contextDependencies.has(root));
    assert.ok(compilation.missingDependencies.has(target));
    // The staged parent predates this build. Only the restored child's birth time is new.
    await delay(25);
    const restored = path.join(staged, 'restored');
    fs.mkdirSync(restored);
    fs.utimesSync(restored, old, old);
    fs.renameSync(parent, path.join(tmp, 'previous-pages'));
    fs.renameSync(staged, parent);
    fs.utimesSync(root, old, old);
  });

  const events = new EventEmitter();
  const builds = on(events, 'build', { signal: AbortSignal.timeout(15000) });
  const watching = compiler.watch({ aggregateTimeout: 15 }, (error, stats) => {
    if (error || stats.hasErrors()) {
      events.emit('error', error ?? new Error(stats.toString()));
      return;
    }
    events.emit('build', {
      number,
      changes: new Set(compiler.modifiedFiles),
      entry: compiler.fileTimestamps?.get(target),
    });
  });
  async function next(expected) {
    const build = (await builds.next()).value[0];
    assert.equal(build.number, expected);
    return build;
  }
  async function watchTimes(matches) {
    const deadline = performance.now() + 6000;
    for (;;) {
      const times = compiler.watchFileSystem.getTimes();
      if (matches(times)) return times;
      if (performance.now() >= deadline) throw new Error('Timed out waiting for watch registration');
      await delay(4);
    }
  }

  try {
    await next(1);
    await watchTimes(times => times[target] === null && typeof times[entry] === 'number');
    await delay(80);
    fs.writeFileSync(entry, 'on');
    await next(2);
    const restored = await next(3);
    assert.ok(restored.changes.has(root));
    assert.ok(restored.changes.has(target));
    await watchTimes(times => typeof times[root] === 'number');
    await delay(45);
    fs.writeFileSync(entry, 'off');
    await next(4);
    await watchTimes(times => !(root in times) && target in times);
    fs.writeFileSync(entry, 'off-again');
    const final = await next(5);
    assert.ok(final.changes.has(entry));
    assert.ok(final.entry === null || typeof final.entry?.timestamp === 'number');
    const disk = fs.statSync(target);
    assert.ok(disk.isDirectory());
    assert.equal(Math.round(disk.mtimeMs), timestamp);
    return {
      diskMtime: timestamp,
      compilerTimestamp: final.entry === null ? null : final.entry.timestamp,
    };
  } finally {
    await builds.return();
    await new Promise((resolve, reject) => watching.close(e => e ? reject(e) : resolve()));
    await new Promise((resolve, reject) => compiler.close(e => e ? reject(e) : resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await readSnapshot()));
} else {
  function run(binding) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
      env: { ...process.env, NAPI_RS_NATIVE_LIBRARY_PATH: path.resolve(binding) },
      encoding: 'utf8',
      timeout: 22000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const binary = 'rspack.linux-x64-gnu.node';
  const main = run(process.argv[2] ?? path.join('main', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ main, head }));
  assert.deepEqual(main, { diskMtime: timestamp, compilerTimestamp: timestamp });
  assert.deepEqual(head, { diskMtime: timestamp, compilerTimestamp: null });
}
