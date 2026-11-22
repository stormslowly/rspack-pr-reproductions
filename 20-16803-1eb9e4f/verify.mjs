import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(import.meta.url);
const binary = 'rspack.linux-x64-gnu.node';
const count = 8;

function inotifyInstances() {
  return fs.readdirSync('/proc/self/fd').filter((fd) => {
    try {
      return fs.readlinkSync('/proc/self/fd/' + fd).includes('inotify');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return false;
    }
  }).length;
}

async function observe(binding) {
  const { NativeWatcher } = createRequire(import.meta.url)(
    path.resolve(binding),
  );
  const before = inotifyInstances();
  const closed = new NativeWatcher({});
  assert.equal(inotifyInstances(), before + 1);
  await closed.close();
  for (let i = 0; i < 50 && inotifyInstances() !== before; ++i) await delay(10);
  assert.equal(
    inotifyInstances(),
    before,
    'explicit close must release the instance',
  );
  const refs = Array.from(
    { length: count },
    () => new WeakRef(new NativeWatcher({})),
  );
  const created = inotifyInstances() - before;
  assert.equal(created, count);
  let liveObjects;
  for (let i = 0; i < 80; ++i) {
    await delay(20);
    global.gc();
    await delay(5);
    liveObjects = refs.filter((ref) => ref.deref() !== undefined).length;
    if (!liveObjects && inotifyInstances() === before) break;
  }
  return { created, liveObjects, remaining: inotifyInstances() - before };
}

if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await observe(process.argv[3])));
} else {
  function run(binding) {
    const c = spawnSync(
      process.execPath,
      ['--expose-gc', script, '--worker', path.resolve(binding)],
      { encoding: 'utf8', timeout: 15000 },
    );
    if (c.error) throw c.error;
    assert.equal(c.status, 0, c.stderr || c.stdout);
    return JSON.parse(c.stdout);
  }
  const base = run(process.argv[2] ?? path.join('base', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ base, head }));
  assert.equal(base.liveObjects, 0);
  assert.equal(head.liveObjects, 0);
  assert.equal(base.remaining, 0);
  assert.equal(head.remaining, count);
}
