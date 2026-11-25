import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function buildTwice() {
  const { rspack } = await import('@rspack/core');
  const require = createRequire(import.meta.url);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-restored-loader-'));
  const context = path.join(root, 'src');
  const missing = path.join(context, 'pages', 'restored');
  const project = path.join(root, 'project');
  const output = path.join(root, 'dist');
  const bundle = path.join(output, 'bundle.js');
  const loader = path.join(project, 'loader.cjs');
  const old = 1600000000.123;
  function writeSource(file, contents) {
    fs.writeFileSync(file, contents);
    fs.utimesSync(file, old, old);
  }
  function readBundle() {
    delete require.cache[bundle];
    return require(bundle);
  }

  fs.mkdirSync(path.dirname(missing), { recursive: true });
  fs.mkdirSync(project);
  writeSource(path.join(project, 'index.js'), "require('./context'); module.exports = require('./value');");
  writeSource(path.join(project, 'value.js'), '');
  writeSource(path.join(project, 'context.js'), '');
  writeSource(loader, `
const fs = require('node:fs');
module.exports = function () {
  if (this.resourcePath.endsWith('context.js')) {
    this.addContextDependency(${JSON.stringify(context)});
    return 'module.exports = 0;';
  }
  const missing = ${JSON.stringify(missing)};
  this.addMissingDependency(missing);
  const value = fs.existsSync(missing) ? 'present' : 'absent';
  return 'module.exports = ' + JSON.stringify(value) + ';';
};
`);
  fs.utimesSync(context, old, old);
  await delay(70);

  const compiler = rspack({
    mode: 'development',
    devtool: false,
    context: project,
    entry: './index.js',
    target: 'node',
    output: { path: output, filename: 'bundle.js', library: { type: 'commonjs2' } },
    experiments: { nativeWatcher: true },
    module: { rules: [{ test: /(?:value|context)\.js$/, use: loader }] },
  });
  let watching;
  try {
    return await new Promise((resolve, reject) => {
      let builds = 0;
      const timer = setTimeout(() => reject(new Error('Timed out waiting for rebuild')), 10000);
      watching = compiler.watch({ aggregateTimeout: 30 }, (error, stats) => {
        try {
          if (error) throw error;
          if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
          if (++builds === 1) {
            assert.equal(readBundle(), 'absent');
            assert.ok(stats.compilation.missingDependencies.has(missing));
            assert.ok(stats.compilation.contextDependencies.has(context));
            fs.mkdirSync(missing);
            fs.utimesSync(missing, old, old);
            return;
          }
          clearTimeout(timer);
          resolve({
            contextChanged: compiler.modifiedFiles.has(context),
            missingDirectoryChanged: compiler.modifiedFiles.has(missing),
            output: readBundle(),
          });
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  } finally {
    if (watching) await new Promise((resolve, reject) => watching.close(error => error ? reject(error) : resolve()));
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--worker') {
  console.log(JSON.stringify(await buildTwice()));
} else {
  function run(binding) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
      env: { ...process.env, NAPI_RS_NATIVE_LIBRARY_PATH: path.resolve(binding) },
      encoding: 'utf8',
      timeout: 20000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  const binary = 'rspack.linux-x64-gnu.node';
  const main = run(process.argv[2] ?? path.join('main', binary));
  const head = run(process.argv[3] ?? path.join('head', binary));
  console.log(JSON.stringify({ main, head }));
  assert.deepEqual(main, { contextChanged: true, missingDirectoryChanged: true, output: 'present' });
  assert.deepEqual(head, { contextChanged: true, missingDirectoryChanged: false, output: 'absent' });
}
