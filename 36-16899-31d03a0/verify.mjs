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
const count = 4096;

async function observe(binding) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rspack-ignored-'));
  const src = path.join(root, 'src');
  const control = path.join(root, 'control');
  fs.mkdirSync(src);
  fs.mkdirSync(control);
  const entry = path.join(src, 'entry.js');
  const bundle = path.join(root, 'out', 'bundle.js');
  const flag = name => fs.existsSync(path.join(control, name));
  const hasOutput = token => fs.existsSync(bundle) && fs.readFileSync(bundle, 'utf8').includes(token);
  const noise = Array.from({ length: count }, (_, i) => path.join(src, 'noise-' + i));
  for (const file of [...noise, path.join(src, 'ready-probe'), path.join(src, 'after-probe'),
    path.join(control, 'resume-input'), entry]) {
    fs.writeFileSync(file, file === entry ? "module.exports = 'INITIAL_OUTPUT';" : '', { mode: 0o644 });
    fs.utimesSync(file, 1600000000.123, 1600000000.123);
  }
  const child = spawn(process.execPath, [cli, 'build', '--watch', '--config', path.join(import.meta.dirname, 'rspack.config.mjs')], {
    cwd: import.meta.dirname,
    env: { ...process.env, WATCH_FIXTURE: root, WATCH_NOISE_COUNT: String(count), NAPI_RS_NATIVE_LIBRARY_PATH: path.resolve(binding) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let log = '';
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => { log = (log + data).slice(-4000); });
  async function until(test, description) {
    const deadline = performance.now() + 15000;
    while (!test()) {
      if (child.exitCode !== null || performance.now() > deadline) throw Error(description + '\n' + log);
      await delay(5);
    }
  }
  try {
    await until(() => hasOutput('INITIAL_OUTPUT'), 'Missing initial bundle');
    for (let attempt = 0; !flag('ready') && attempt < 40; attempt++) {
      fs.chmodSync(path.join(src, 'ready-probe'), attempt % 2 ? 0o644 : 0o600);
      await delay(80);
    }
    assert.ok(flag('ready'), 'Watch registration did not see a sibling change');
    fs.writeFileSync(entry, "module.exports = 'BUILD_IN_PROGRESS';");
    await until(() => flag('building'), 'Watch rebuild did not enter the loader');
    for (const file of noise) fs.chmodSync(file, 0o600);
    await until(() => flag('seen'), 'The predicate did not see every ignored file while paused');
    fs.writeFileSync(path.join(control, 'release'), '');
    await until(() => hasOutput('BUILD_IN_PROGRESS') && flag('resuming'), 'Watch did not resume');
    const start = performance.now();
    fs.writeFileSync(entry, "module.exports = 'FINAL_OUTPUT';");
    await until(() => hasOutput('FINAL_OUTPUT'), 'Final source edit was not compiled');
    const editToBundleMs = Math.round(performance.now() - start);
    fs.writeFileSync(path.join(control, 'capture'), '');
    fs.chmodSync(path.join(src, 'after-probe'), 0o600);
    await until(() => flag('counts'), 'The watcher did not process the final marker');
    const [ignoredWhilePaused, reevaluated] = JSON.parse(fs.readFileSync(path.join(control, 'counts'), 'utf8'));
    return { ignoredWhilePaused, reevaluated, editToBundleMs };
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await closed;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const [label, binary] of [['base', base], ['head', head]]) {
  const result = await observe(binary);
  console.log(label, JSON.stringify(result));
  assert.equal(result.ignoredWhilePaused, count);
  assert.equal(result.reevaluated, label === 'base' ? 0 : count);
}
