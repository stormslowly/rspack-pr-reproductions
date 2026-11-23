import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const binary = 'rspack.linux-x64-gnu.node';
const initialEntry = "module.exports = require.context('./src', true, /\\.route\\.js$/).keys();\n";
const featureCount = 8;

function pageDirectories(root) {
  return Array.from({ length: featureCount }, (_, i) => path.join(root, 'src', 'feature-' + i, 'pages'));
}

function createFixture(root) {
  for (const dir of pageDirectories(root)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'screen.route.js'), 'module.exports = 1;');
    for (let j = 0; j < 128; j++) {
      fs.writeFileSync(path.join(path.dirname(dir), 'asset-' + j + '.txt'), 'asset');
    }
  }
  const lib = path.join(root, 'src', 'lib');
  fs.mkdirSync(lib);
  for (let i = 0; i < 512; i++) {
    fs.writeFileSync(path.join(lib, 'util-' + i + '.js'), 'module.exports = 42;');
  }
}

async function observe(coreFile, root) {
  const { rspack } = await import(pathToFileURL(coreFile));
  const pages = pageDirectories(root);
  const entry = path.join(root, 'index.cjs');
  const newContexts = pages.map(dir => {
    const request = JSON.stringify('./' + path.relative(root, dir));
    return 'require.context(' + request + ', false, /\\.route\\.js$/).keys();';
  });
  newContexts.push("require.context('./src/lib', false, /\\.js$/).keys();");
  fs.writeFileSync(entry, initialEntry);
  fs.utimesSync(entry, 1_700_000_000, 1_700_000_000);

  const compiler = rspack({
    context: root, mode: 'development', entry: './index.cjs', target: 'node', devtool: false,
    output: { path: path.join(root, 'dist'), filename: 'app.cjs' },
    experiments: { nativeWatcher: true },
  });
  let phase = 'initial';
  let initialExplicitCount;
  let missingDuringRebuild;
  let buildError;
  let handle;

  compiler.hooks.afterDone.tap('RepeatBuild', stats => {
    const explicit = pages.filter(dir => stats.compilation.contextDependencies.has(dir)).length;
    if (phase === 'initial') initialExplicitCount = explicit;
    if (phase === 'editing' && explicit === pages.length) {
      phase = 'queued';
      // Watching schedules the renewed watch before it calls afterDone.
      process.nextTick(() => {
        phase = 'invalidating';
        handle.invalidate();
      });
    }
  });
  compiler.hooks.watchRun.tap('ReadDirectoryTimes', () => {
    if (phase !== 'invalidating') return;
    const timestamps = compiler.contextTimestamps;
    assert.ok(timestamps instanceof Map);
    missingDuringRebuild = pages.filter(dir => !timestamps.has(dir)).map(dir => path.relative(root, dir));
    phase = 'observed';
  });

  handle = compiler.watch({ aggregateTimeout: 70 }, (err, stats) => {
    if (err || stats.hasErrors()) {
      buildError = err ?? new Error(stats.toString({ all: false, errors: true }));
    }
    if (phase === 'observed') phase = 'complete';
  });

  function liveSnapshotIncludesPages() {
    const directories = new Map();
    compiler.watchFileSystem.collectTimeInfoEntries(new Map(), directories);
    return pages.every(dir => typeof directories.get(dir)?.safeTime === 'number');
  }
  async function waitFor(ready, description) {
    const deadline = Date.now() + 20_000;
    do {
      if (buildError) throw buildError;
      if (ready()) return;
      await delay(15);
    } while (Date.now() < deadline);
    throw new Error('Timed out waiting for ' + description + ' in phase ' + phase);
  }

  try {
    await waitFor(() => initialExplicitCount !== undefined && liveSnapshotIncludesPages(), 'the initial snapshot');
    assert.equal(initialExplicitCount, 0);
    phase = 'editing';
    fs.writeFileSync(entry, initialEntry + newContexts.join('\n'));
    await waitFor(() => phase === 'complete', 'the manually invalidated build');
    await waitFor(liveSnapshotIncludesPages, 'the settled snapshot');
    return missingDuringRebuild;
  } finally {
    await new Promise(done => handle.close(done));
    await new Promise(done => compiler.close(done));
  }
}

if (process.argv[2] === '--observe') {
  console.log(JSON.stringify(await observe(process.argv[3], process.argv[4])));
} else {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  const bindings = {
    base: path.resolve(process.argv[2] ?? path.join('base', binary)),
    head: path.resolve(process.argv[3] ?? path.join('head', binary)),
  };
  const coreFile = path.resolve(process.argv[4] ?? 'package/dist/index.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-nested-context-')));
  try {
    createFixture(root);
    await delay(2100);
    const results = { base: [], head: [] };
    for (const side of ['base', 'head', 'head', 'base', 'base', 'head', 'head', 'base']) {
      const stdout = execFileSync(process.execPath,
        [fileURLToPath(import.meta.url), '--observe', coreFile, root],
        { env: { ...process.env, RSPACK_BINDING: bindings[side] }, encoding: 'utf8', timeout: 60_000 });
      results[side].push(JSON.parse(stdout));
    }
    for (const [side, runs] of Object.entries(results)) {
      console.log(side + ' missing directory counts: ' + runs.map(dirs => dirs.length).join(', '));
    }
    const example = results.head.find(dirs => dirs.length > 0);
    assert.ok(example, 'Expected at least one incomplete head snapshot');
    console.log('Example missing directories: ' + example.join(', '));
    const incomplete = runs => runs.filter(dirs => dirs.length > 0).length;
    assert.ok(incomplete(results.head) > incomplete(results.base), 'Expected more incomplete snapshots on head');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
