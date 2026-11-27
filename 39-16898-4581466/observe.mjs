import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { initialMarker, median, moduleCount, writeMarker } from './fixture.mjs';

const [core, root] = process.argv.slice(2);
const { rspack } = await import(pathToFileURL(core).href);
const marker = path.join(root, 'src', 'stamp.js');
const outputDir = path.join(root, 'dist');
const compiler = rspack({
  mode: 'development',
  context: root,
  entry: './src/index.js',
  devtool: false,
  output: { path: outputDir, filename: 'bundle.js' },
  resolve: { extensions: ['.js', '.jsx', '.json', '.ts'] },
  experiments: { nativeWatcher: true },
});

let aggregateAt = 0;
let watchRunAt = 0;
compiler.watchFileSystem.on('aggregated', changed => {
  if (changed.has(marker)) aggregateAt = performance.now();
});
compiler.hooks.watchRun.tap('MeasureTimestamps', () => { watchRunAt = performance.now(); });

const events = new EventEmitter();
const nextBuild = () => once(events, 'built', { signal: AbortSignal.timeout(90000) });
let expected = initialMarker;
const initial = nextBuild();
const watching = compiler.watch({ aggregateTimeout: 5 }, (error, stats) => {
  const doneAt = performance.now();
  if (error || stats.hasErrors()) {
    events.emit('error', error ?? new Error(stats.toString({ all: false, errors: true })));
    return;
  }
  if (!expected) return;
  const bundle = fs.readFileSync(path.join(outputDir, 'bundle.js'), 'utf8');
  if (bundle.includes(expected)) {
    expected = undefined;
    events.emit('built', { aggregateAt, watchRunAt, doneAt });
  }
});

try {
  await initial;
  expected = 'WATCH_READY_VALUE';
  const ready = nextBuild();
  writeMarker(root, expected);
  const retry = setInterval(() => { if (expected) writeMarker(root, expected); }, 250);
  try {
    await ready;
  } finally {
    clearInterval(retry);
  }

  const beforeWatchRun = [];
  const editToDone = [];
  for (let i = 0; i < 19; i++) {
    await delay(150);
    expected = 'WATCH_UPDATED_' + i + '_VALUE';
    const built = nextBuild();
    aggregateAt = 0;
    const editAt = performance.now();
    writeMarker(root, expected);
    const [observed] = await built;
    assert.ok(observed.aggregateAt >= editAt && observed.watchRunAt >= observed.aggregateAt);
    if (i >= 3) {
      beforeWatchRun.push(observed.watchRunAt - observed.aggregateAt);
      editToDone.push(observed.doneAt - editAt);
    }
  }

  await delay(150);
  const handle = watching.watcher;
  assert.ok(handle, 'Expected an idle, registered watch handle');
  const { fileTimeInfoEntries: files, contextTimeInfoEntries: contexts } = handle.getInfo();
  assert.ok(files.get(path.join(root, 'src', 'group-0', 'module-0.ts')).timestamp > 0);
  assert.equal(files.get(path.join(root, 'src', 'group-0', 'module-0.js')), null);
  const missing = Array.from(files.values()).filter(value => value === null).length;
  assert.ok(missing >= 4 * moduleCount);
  assert.equal(contexts.size, 0);

  const capture = [];
  for (let i = 0; i < 21; i++) {
    global.gc();
    const start = performance.now();
    handle.getInfo();
    const elapsed = performance.now() - start;
    if (i >= 3) capture.push(elapsed);
  }
  console.log(JSON.stringify({
    files: files.size - missing, missing, contexts: contexts.size,
    snapshotMs: median(capture),
    aggregateToWatchRunMs: median(beforeWatchRun),
    editToDoneMs: median(editToDone),
  }));
} finally {
  await new Promise((resolve, reject) => watching.close(e => e ? reject(e) : resolve()));
  await new Promise((resolve, reject) => compiler.close(e => e ? reject(e) : resolve()));
}
