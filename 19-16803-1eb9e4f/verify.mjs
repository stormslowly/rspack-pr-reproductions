import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const empty = [[], []];
const binary = 'rspack.linux-x64-gnu.node';
assert.equal(process.platform, 'linux', 'Run on Linux with inotify');

function watchCount() {
  let count = 0;
  for (const fd of fs.readdirSync('/proc/self/fdinfo')) {
    try {
      count +=
        fs.readFileSync('/proc/self/fdinfo/' + fd, 'utf8').match(/^inotify /gm)
          ?.length ?? 0;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return count;
}

async function measure(NativeWatcher, size) {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rspack-watch-registration-'),
  );
  const src = path.join(tmp, 'src');
  const marker = path.join(tmp, 'ignored-marker');
  const missing = path.join(src, 'generated', 'entry.js');
  fs.mkdirSync(src);
  for (let i = 0; i < size; i++) fs.mkdirSync(path.join(src, 'pkg-' + i));
  const installs = [];
  const removals = [];
  try {
    for (let i = 0; i < 6; ++i) {
      let reached;
      const errors = [];
      const watcher = new NativeWatcher({
        aggregateTimeout: 10,
        ignored(file) {
          if (file !== marker) return false;
          reached();
          return true;
        },
      });
      function watch(files, missingPaths) {
        watcher.watch(
          files,
          empty,
          missingPaths,
          BigInt(Date.now()),
          (error) => {
            if (error) errors.push(error.message);
          },
          () => {},
        );
      }
      // A subsequent ignored marker acknowledges all earlier FIFO watch requests.
      const checkpoint = () =>
        new Promise((resolve) => {
          reached = resolve;
          watch([[marker], []], empty);
        });
      try {
        await checkpoint();
        await checkpoint();
        let start = performance.now();
        watch(empty, [[missing], []]);
        await checkpoint();
        const installedMs = performance.now() - start;
        assert.equal(watchCount(), size + 1);
        await checkpoint();
        start = performance.now();
        watch(empty, [[], [missing]]);
        await checkpoint();
        const removedMs = performance.now() - start;
        assert.equal(watchCount(), 0);
        assert.deepEqual(errors, []);
        if (i) {
          installs.push(Number(installedMs.toFixed(3)));
          removals.push(Number(removedMs.toFixed(3)));
        }
      } finally {
        await watcher.close();
      }
    }
    const median = (a) => [...a].sort((a, b) => a - b)[2];
    return {
      size,
      installs,
      installMedian: median(installs),
      removals,
      removalMedian: median(removals),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--worker') {
  const { NativeWatcher } = createRequire(import.meta.url)(
    path.resolve(process.argv[3]),
  );
  const rows = [];
  for (const size of [1000, 4000, 8000])
    rows.push(await measure(NativeWatcher, size));
  console.log(JSON.stringify(rows));
} else {
  const script = fileURLToPath(import.meta.url);
  function run(binding) {
    const c = spawnSync(
      process.execPath,
      [script, '--worker', path.resolve(binding)],
      { encoding: 'utf8', timeout: 240000 },
    );
    if (c.error) throw c.error;
    assert.equal(c.status, 0, c.stderr || c.stdout);
    return JSON.parse(c.stdout);
  }
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }));
  assert.ok(head.at(-1).installMedian > 1.5 * base.at(-1).installMedian);
  assert.ok(head.at(-1).removalMedian > 1.5 * base.at(-1).removalMedian);
}
