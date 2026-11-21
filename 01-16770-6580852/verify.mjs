import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shim = {
  resolved: 'browser.js',
  bundled: 'browser transport',
  directIgnored: false,
  directBrowser: 'browser.js',
};
const ignored = { ...shim, resolved: false, bundled: {} };
const expected = { base: shim, head: ignored, webpack: shim };
let results;
const args = process.argv.slice(2);
if (args.length === 0) {
  results = JSON.parse(readFileSync(new URL('evidence.json', import.meta.url))).results;
} else {
  if (args.length !== 3 || args[0] !== '--live') {
    throw new Error('Usage: node verify.mjs [--live BASE.node HEAD.node]');
  }
  const script = fileURLToPath(new URL('run.mjs', import.meta.url));
  const run = engine => JSON.parse(execFileSync(process.execPath, [script, engine], { encoding: 'utf8' }));
  results = { base: run(args[1]), head: run(args[2]), webpack: run('webpack') };
}
assert.deepEqual(results, expected);
console.log('PASS: base and webpack bundle the browser transport. The PR resolves to false and bundles {}.');
