import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [base, head] = process.argv.slice(2);
const cli = process.env.RSPACK_CLI;
assert.ok(cli && fs.existsSync(cli), 'Set RSPACK_CLI to the absolute path of the built checkout\'s packages/rspack-cli/bin/rspack.js');
assert.ok(base && head, 'Use node verify.mjs BASE.node HEAD.node');
const siblings = 16000;

async function observe(binary) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rspack-initial-scan-'));
  const watched = path.join(root, 'watched');
  const pages = path.join(watched, 'pages');
  const deep = path.join(pages, 'deep');
  const receipt = path.join(root, 'builds.jsonl');
  fs.mkdirSync(deep, { recursive: true });
  function writeOld(file, value) {
    fs.writeFileSync(file, value);
    fs.utimesSync(file, 1600000000.123, 1600000000.123);
  }
  for (let i = 0; i < siblings; i++) writeOld(path.join(pages, 'page-' + i), '');
  writeOld(path.join(root, 'entry.js'), 'module.exports = 0;');
  writeOld(path.join(watched, 'first.txt'), 'old-first');
  writeOld(path.join(deep, 'last.txt'), 'old-last');
  for (const dir of [deep, pages, watched]) fs.utimesSync(dir, 1600000000.123, 1600000000.123);
  const child = spawn(process.execPath, [cli, 'build', '--watch', '--config', path.join(import.meta.dirname, 'rspack.config.mjs')], {
    cwd: import.meta.dirname,
    env: { ...process.env, WATCH_FIXTURE: root, NAPI_RS_NATIVE_LIBRARY_PATH: path.resolve(binary) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let log = '';
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => { log = (log + data).slice(-4000); });
  const rows = () => fs.existsSync(receipt)
    ? fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : [];
  try {
    const deadline = performance.now() + 15000;
    while (rows().length < 2) {
      if (child.exitCode !== null || performance.now() > deadline) throw Error('Missing catch-up build\n' + log);
      await delay(10);
    }
    await delay(2000);
    return rows();
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await closed;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const [label, binary] of [['base', base], ['head', head]]) {
  const builds = await observe(binary);
  assert.deepEqual(builds[0].values, ['old-first', 'old-last']);
  assert.deepEqual(builds[1].values, ['new-first', 'new-last']);
  assert.notEqual(builds[0].bundle, builds[1].bundle);
  console.log(label, JSON.stringify(builds.map(({ at, ...row }) => ({ ...row, elapsedMs: Math.round(at - builds[0].at) }))));
  if (label === 'base') {
    assert.equal(builds.length, 2);
  } else {
    assert.ok(builds.length > 2, 'The scan must span two aggregation windows to reproduce the extra build');
    for (const later of builds.slice(2)) {
      assert.equal(later.bundle, builds[1].bundle);
      assert.deepEqual(later.values, builds[1].values);
    }
  }
}
