import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'base';
const head = process.argv[3] ?? 'head';
const build = fileURLToPath(new URL('./build.mjs', import.meta.url));

function run(checkout, api) {
  const stdout = execFileSync(process.execPath, [build, checkout, api], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(stdout);
}

for (const api of ['this.resolve', 'this.getResolve']) {
  const control = run(base, api);
  const candidate = run(head, api);
  for (const [revision, result] of [['base', control], ['head', candidate]]) {
    console.log(`${api} ${revision}: code=${result.code}, errors=${result.errors.length}, output=${result.output}, tracksPreferred=${result.tracksPreferred}`);
  }
  assert.deepEqual(control, { code: 'GenericFailure', errors: [], output: 'DEFAULT', tracksPreferred: false });
  assert.equal(candidate.code, 'undefined');
  assert.equal(candidate.errors.length, 1);
  assert.match(candidate.errors[0], /NotFound[^\n]*preferred-theme/);
  assert.equal(candidate.output, null);
  assert.equal(candidate.tracksPreferred, true);
}
