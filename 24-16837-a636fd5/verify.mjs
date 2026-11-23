import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const directoryCount = 32;
const siblingCount = 48;
const stamp = new Date('2024-04-01T10:00:00.321Z');
const binaryName = 'rspack.linux-x64-gnu.node';

function pathsFor(root) {
  return Array.from({ length: directoryCount }, (_, index) => {
    const name = 'components-' + index;
    const dir = path.join(root, 'src', name);
    // Keep the separator in the subscription. path.join would normalize it.
    const alias = root + '/src//' + name;
    const siblings = Array.from({ length: siblingCount }, (_, i) => path.join(dir, 'item-' + i + '.js'));
    return { name, dir, alias, siblings };
  });
}

async function waitForSnapshot(watcher, ready) {
  const deadline = Date.now() + 10_000;
  do {
    const snapshot = watcher.collectTimeInfoEntries();
    const files = new Map(snapshot.fileTimestamps.entries.map(row => [row.path, row.safeTime]));
    const dirs = new Map(snapshot.directoryTimestamps.entries.map(row => [row.path, row.safeTime]));
    if (ready(files, dirs)) return { files, dirs };
    await delay(10);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for the native watcher to report the fixture');
}

async function observe(binding, root) {
  const { NativeWatcher } = createRequire(import.meta.url)(path.resolve(binding));
  const watcher = new NativeWatcher({});
  const cases = pathsFor(root);
  try {
    const missing = cases.map(c => c.alias + '/optional.js');
    watcher.watch([[], []], [[root], []], [missing, []], BigInt(Date.now()),
      error => assert.ifError(error), () => {});
    const before = await waitForSnapshot(watcher, (files, dirs) =>
      cases.every(c => dirs.get(c.dir) > 0 && c.siblings.every(file => files.has(file))));
    for (const c of cases) fs.writeFileSync(path.join(c.dir, 'new.js'), 'new');
    const after = await waitForSnapshot(watcher, files =>
      cases.every(c => files.get(c.alias + '/new.js') > before.dirs.get(c.dir)));

    return cases.map(c => ({
      name: c.name,
      before: before.dirs.get(c.dir),
      after: after.dirs.get(c.dir),
      file: after.files.get(c.alias + '/new.js'),
    }));
  } finally {
    await watcher.close();
  }
}

function run(binding, root) {
  const output = execFileSync(process.execPath,
    [fileURLToPath(import.meta.url), '--observe', binding, root],
    { encoding: 'utf8', timeout: 30_000 });
  return JSON.parse(output);
}

assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
if (process.argv[2] === '--observe') {
  console.log(JSON.stringify(await observe(process.argv[3], process.argv[4])));
} else {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-context-members-')));
  const cases = pathsFor(root);
  try {
    for (const c of cases) {
      fs.mkdirSync(c.dir, { recursive: true });
      for (const file of c.siblings) {
        fs.writeFileSync(file, 'old');
        fs.utimesSync(file, stamp, stamp);
      }
    }
    // Start both watches after the fixture directories' creation times.
    await delay(2200);
    const base = run(process.argv[2] ?? path.join('base', binaryName), root);
    for (const c of cases) fs.unlinkSync(path.join(c.dir, 'new.js'));
    const head = run(process.argv[3] ?? path.join('head', binaryName), root);

    const baseZeros = base.filter(row => row.after === 0).length;
    const headZeros = head.filter(row => row.after === 0).length;
    const regression = head.findIndex((row, i) => base[i].after >= base[i].file && row.after === 0);
    console.log('Directories returning zero after a real file creation: base ' +
      baseZeros + '/' + directoryCount + ', head ' + headZeros + '/' + directoryCount);
    assert.notEqual(regression, -1, 'Expected a directory that covered the change on base and returned zero on head');
    assert.ok(headZeros > baseZeros, 'Expected more affected directories on head');
    console.log(JSON.stringify({ base: base[regression], head: head[regression] }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
