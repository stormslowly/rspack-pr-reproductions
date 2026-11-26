import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import testCase from './original-case.mjs';

async function teachTimestampPrecision(binding, directory) {
  const { NativeWatcher } = createRequire(import.meta.url)(binding);
  const seed = path.join(directory, 'millisecond-mtime');
  fs.writeFileSync(seed, '');
  fs.utimesSync(seed, 1600000000.123, 1600000000.123);
  const watcher = new NativeWatcher({});
  try {
    watcher.watch([[seed], []], [[], []], [[], []], BigInt(Date.now()), assert.ifError, () => {});
    const deadline = performance.now() + 5000;
    while (!watcher.collectTimeInfoEntries().fileTimestamps.entries.some(e => e.path === seed && e.timestamp)) {
      if (performance.now() >= deadline) throw new Error('Timed out waiting for the calibration file');
      await delay(3);
    }
  } finally {
    await watcher.close();
  }
}

async function runOriginalCase(mode) {
  const { rspack } = await import('@rspack/core');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-test-order-'));
  if (mode === 'calibrated') {
    await teachTimestampPrecision(process.env.NAPI_RS_NATIVE_LIBRARY_PATH, directory);
  }
  const compiler = rspack({
    ...testCase.options(),
    mode: 'production',
    context: directory,
    optimization: { minimize: false },
    output: { path: path.join(directory, 'dist'), pathinfo: true },
  });
  // The checked-in compiler case uses only strict equality and Set equality.
  const batches = [];
  globalThis.expect = actual => ({
    toEqual(expected) {
      batches.push([...actual].map(p => path.basename(p)).sort());
      assert.deepEqual(actual, expected);
    },
    toBe(expected) { assert.equal(actual, expected); },
  });
  try {
    await testCase.build({}, compiler);
    return { passed: true, batches };
  } catch (error) {
    if (!(error instanceof assert.AssertionError) || !error.stack.includes('original-case.mjs:57:')) {
      throw error;
    }
    return { passed: false, batches };
  } finally {
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

assert.equal(process.platform, 'linux');
if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await runOriginalCase(process.argv[3])));
} else {
  function run(binding, mode) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', mode], {
      env: { ...process.env, NAPI_RS_NATIVE_LIBRARY_PATH: path.resolve(binding) },
      encoding: 'utf8', timeout: 20000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  const binary = 'rspack.linux-x64-gnu.node';
  const binding = process.argv[2] ?? path.join('head', binary);
  const isolated = run(binding, 'isolated');
  const calibrated = run(binding, 'calibrated');
  console.log(JSON.stringify({ isolated, calibrated }));
  const restoration = ['restored', 'src'];
  assert.deepEqual(isolated, { passed: false, batches: [restoration, ['marker', 'restored', 'src']] });
  assert.deepEqual(calibrated, { passed: true, batches: [restoration, ['marker'], restoration] });
}
