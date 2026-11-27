import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialMarker, writeMarker, writeProject } from './fixture.mjs';

const [base, head] = process.argv.slice(2);
assert.ok(base && head && process.env.RSPACK_CORE,
  'Set RSPACK_CORE to the built packages/rspack/dist/index.js and run node verify.mjs BASE.node HEAD.node');
const core = fs.realpathSync(process.env.RSPACK_CORE);
const versions = { base: fs.realpathSync(base), head: fs.realpathSync(head) };
const observer = fileURLToPath(new URL('./observe.mjs', import.meta.url));
const fixture = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rspack-watch-snapshot-'));
const records = { base: [], head: [] };

try {
  writeProject(fixture);
  for (const version of ['base', 'head', 'head', 'base']) {
    writeMarker(fixture, initialMarker);
    const output = execFileSync(process.execPath, ['--expose-gc', observer, core, fixture], {
      env: { ...process.env, NAPI_RS_NATIVE_LIBRARY_PATH: versions[version] },
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
      timeout: 180000,
    });
    const result = JSON.parse(output);
    records[version].push(result);
    console.log(version, result);
  }
  const baseline = records.base[0];
  for (const sample of [...records.base, ...records.head]) {
    assert.deepEqual([sample.files, sample.missing, sample.contexts],
      [baseline.files, baseline.missing, baseline.contexts]);
  }
  const slowestBase = Math.max(...records.base.map(row => row.snapshotMs));
  const fastestHead = Math.min(...records.head.map(row => row.snapshotMs));
  assert.ok(fastestHead > slowestBase * 1.2,
    'The expected snapshot regression was not reproduced on this run');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
