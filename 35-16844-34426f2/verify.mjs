import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter, on } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const knownMtime = 1600000000123;
async function observe(mode, coreModule) {
  const { rspack } = coreModule ? await import(pathToFileURL(path.resolve(coreModule)).href) : await import('@rspack/core');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-queued-subtree-'));
  const project = path.join(tmp, 'project');
  const src = path.join(tmp, 'src');
  const pages = path.join(src, 'pages');
  const directory = path.join(pages, 'generated');
  const watchDirectoryAsMissing = mode !== 'only-file';
  const retainedNested = mode === 'retained-context';
  const rescan = mode === 'rescan';
  const queuedNested = path.join(tmp, 'prepared-nested');
  const nested = path.join(directory, 'nested');
  const child = path.join(nested, 'entry.js');
  const implicitFile = path.join(nested, 'context-only.js');
  const scanMarker = path.join(directory, 'scan-marker.js');
  const busy = path.join(tmp, 'busy');
  const staged = path.join(tmp, 'staging');
  const moved = path.join(busy, 'batch');
  const initialMarker = path.join(busy, 'initial');
  const fence = path.join(project, 'fence');
  const ready = path.join(project, 'ready');
  const phaseFile = path.join(tmp, 'phase');
  const loader = path.join(project, 'deps.cjs');
  const filesInBatch = 512;
  const old = knownMtime / 1000;
  function writeAged(file, content = '') {
    fs.writeFileSync(file, content);
    fs.utimesSync(file, old, old);
  }
  for (const dir of [project, pages, busy, staged]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(queuedNested);
  writeAged(path.join(queuedNested, 'entry.js'), 'module.exports = 1;');
  writeAged(path.join(queuedNested, 'context-only.js'));
  fs.utimesSync(queuedNested, old, old);
  for (const file of [fence, ready, initialMarker]) writeAged(file);
  writeAged(path.join(project, 'index.js'), "require('./control'); require('./selection');");
  writeAged(path.join(project, 'control.js'));
  writeAged(path.join(project, 'selection.js'));
  writeAged(phaseFile, 'initial');
  for (let i = 0; i < filesInBatch; i++) fs.writeFileSync(path.join(staged, String(i)), '');
  writeAged(loader, `
const fs = require('node:fs');
module.exports = function () {
  if (this.resourcePath.endsWith('control.js')) {
    this.addContextDependency(${JSON.stringify(busy)});
    this.addDependency(${JSON.stringify(fence)});
  } else {
    this.cacheable(false);
    const phase = fs.readFileSync(${JSON.stringify(phaseFile)}, 'utf8');
    if (phase !== 'initial') {
      this.addDependency(${JSON.stringify(child)});
      if (${watchDirectoryAsMissing}) this.addMissingDependency(${JSON.stringify(directory)});
      if (phase === 'add') this.addContextDependency(${JSON.stringify(src)});
      if (${retainedNested} || phase === 'rescan') this.addContextDependency(${JSON.stringify(nested)});
    }
    if (phase === 'barrier') this.addDependency(${JSON.stringify(ready)});
  }
  return 'module.exports = 0;';
};
`);

  const compiler = rspack({
    mode: 'development', context: project, entry: './index.js', devtool: false,
    module: { rules: [{ test: /(?:control|selection)\.js$/, use: loader }] },
    output: { path: path.join(tmp, 'dist') },
    experiments: { nativeWatcher: true },
  });
  let phase = 'initial';
  let prepared = false;
  compiler.hooks.afterCompile.tapPromise('GenerateTree', async compilation => {
    if (phase === 'initial') return;
    assert.ok(compilation.fileDependencies.has(child));
    assert.equal(compilation.missingDependencies.has(directory), watchDirectoryAsMissing);
    assert.equal(compilation.contextDependencies.has(src), phase === 'add');
    if (prepared) return;
    await delay(25);
    fs.mkdirSync(directory);
    fs.renameSync(queuedNested, nested);
    writeAged(scanMarker);
    fs.utimesSync(directory, old, old);
    prepared = true;
  });

  const events = new EventEmitter();
  const builds = on(events, 'build', { signal: AbortSignal.timeout(18000) });
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let visits = 0;
  let release = false;
  const watching = compiler.watch({
    aggregateTimeout: 15,
    ignored(file) {
      if (path.dirname(file) === moved) {
        visits++;
        if (!release) Atomics.wait(pause, 0, 0, 3);
      }
      return false;
    },
  }, (error, stats) => {
    if (error || stats.hasErrors()) {
      events.emit('error', error ?? new Error(stats.toString()));
      return;
    }
    const fileInfo = compiler.fileTimestamps?.get(child);
    const contextInfo = compiler.contextTimestamps?.get(nested);
    let contextState = 'unregistered';
    if (contextInfo === null) contextState = 'missing';
    else if (typeof contextInfo?.safeTime === 'number') contextState = 'present';
    events.emit('build', {
      fenceChanged: compiler.modifiedFiles?.has(fence),
      removedDirectory: compiler.removedFiles?.has(directory),
      directoryMissingInSnapshot: compiler.fileTimestamps?.get(directory) === null,
      childTimestamp: fileInfo === null ? null : fileInfo?.timestamp,
      contextFileTimestamp: compiler.fileTimestamps?.get(implicitFile)?.timestamp ?? null,
      contextState,
    });
  });

  const times = () => compiler.watchFileSystem.getTimes();
  const nextBuild = async () => (await builds.next()).value[0];
  async function until(check, label) {
    const deadline = performance.now() + 6000;
    while (!check()) {
      if (performance.now() >= deadline) throw new Error('Timed out waiting for ' + label);
      await delay(3);
    }
  }
  async function rebuild(nextPhase) {
    phase = nextPhase;
    fs.writeFileSync(phaseFile, phase);
    watching.invalidate();
    await nextBuild();
  }
  try {
    await nextBuild();
    await until(() => typeof times()[initialMarker] === 'number', 'the initial watch');
    await delay(65);
    fs.renameSync(staged, moved);
    await until(() => visits > 0, 'the independent move event');
    await rebuild('add');
    await until(() => typeof times()[scanMarker] === 'number', 'the context scan');
    await rebuild('retire');
    await until(() => !(scanMarker in times()), 'context removal');
    if (rescan) {
      assert.ok(!(implicitFile in times()), 'nested context is not being watched yet');
      await rebuild('rescan');
      await until(() => typeof times()[implicitFile] === 'number', 'the second scan');
    }
    // The marker registration follows the previous watch update on the native watcher owner.
    await rebuild('barrier');
    await until(() => typeof times()[ready] === 'number', 'the subsequent watch update');
    if (rescan) await until(() => !(implicitFile in times()), 'the nested context retiring');
    if (retainedNested) assert.equal(typeof times()[implicitFile], 'number');
    assert.ok(visits < filesInBatch, 'the earlier move must still occupy the event processor');
    fs.renameSync(pages, path.join(tmp, 'archived-pages'));
    assert.equal(fs.existsSync(child), false);
    release = true;
    fs.writeFileSync(fence, 'flush');
    for (;;) {
      const build = await nextBuild();
      const { fenceChanged, ...snapshot } = build;
      if (watchDirectoryAsMissing ? build.removedDirectory : fenceChanged) {
        assert.equal(fs.existsSync(nested), false);
        assert.equal(fs.existsSync(implicitFile), false);
        return { childExists: fs.existsSync(child), ...snapshot };
      }
    }
  } finally {
    release = true;
    await builds.return();
    await new Promise((resolve, reject) => watching.close(error => error ? reject(error) : resolve()));
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
if (process.argv[2] === '--worker') {
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = path.resolve(process.argv[3]);
  console.log(JSON.stringify(await observe(process.argv[4], process.argv[5])));
} else {
  const modes = ['plain', 'only-file', 'rescan', 'retained-context'];
  const selected = process.argv[2] ?? 'all';
  assert.ok(selected === 'all' || modes.includes(selected), 'unknown scenario');
  const binary = 'rspack.linux-x64-gnu.node';
  const parentBinding = process.argv[3] ?? path.join('main', binary);
  const headBinding = process.argv[4] ?? path.join('head', binary);
  function run(binding, mode) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', binding, mode], {
      encoding: 'utf8', timeout: 25000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  for (const mode of selected === 'all' ? modes : [selected]) {
    const main = run(parentBinding, mode);
    const head = run(headBinding, mode);
    console.log(JSON.stringify({ mode, main, head }));
    const expected = {
      childExists: false,
      removedDirectory: mode !== 'only-file',
      directoryMissingInSnapshot: mode !== 'only-file',
      childTimestamp: null,
      contextFileTimestamp: null,
      contextState: mode === 'retained-context' ? 'missing' : 'unregistered',
    };
    assert.deepEqual(main, expected);
    const observed = { ...expected };
    if (mode === 'only-file' || mode === 'rescan') observed.childTimestamp = knownMtime;
    if (mode === 'retained-context') {
      observed.contextFileTimestamp = knownMtime;
      observed.contextState = 'present';
    }
    assert.deepEqual(head, observed);
  }
}
