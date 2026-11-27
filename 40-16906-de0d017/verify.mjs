import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function build(coreEntry, context) {
  const { rspack } = await import(pathToFileURL(coreEntry));
  let factoryCalls = 0;
  const compiler = rspack({
    mode: 'development',
    context,
    entry: './index.js',
    output: { path: join(context, 'dist') },
    plugins: [{
      apply(compiler) {
        compiler.hooks.thisCompilation.tap('BuildId', (compilation) => {
          const original = compilation.createStatsFactory;
          compilation.createStatsFactory = function (options) {
            factoryCalls++;
            const factory = original.call(this, options);
            factory.hooks.extract.for('compilation').tap('BuildId', (output) => {
              output.buildId = 'ci-42';
            });
            return factory;
          };
        });
      },
    }],
  });
  try {
    const stats = await new Promise((resolve, reject) => {
      compiler.run((error, stats) => error ? reject(error) : resolve(stats));
    });
    assert.equal(stats.hasErrors(), false);

    function read() {
      const before = factoryCalls;
      const json = stats.toJson({ all: false, hash: true });
      assert.equal(typeof json.hash, 'string');
      assert.ok(json.hash.length > 0);
      return { calls: factoryCalls - before, buildId: json.buildId ?? null };
    }

    const ordinary = read();
    stats.compilation.hooks.statsFactory.tap('Observer', () => {});
    return { ordinary, withObserver: read() };
  } finally {
    await new Promise((resolve, reject) => {
      compiler.close((error) => error ? reject(error) : resolve());
    });
  }
}

if (process.argv[2] === '--one') {
  console.log(JSON.stringify(await build(process.argv[3], process.argv[4])));
} else {
  const [base = 'base/dist/index.js', head = 'head/dist/index.js'] = process.argv.slice(2);
  const fixture = mkdtempSync(join(tmpdir(), 'rspack-build-id-'));
  try {
    writeFileSync(join(fixture, 'index.js'), 'export const value = 42;\n');
    const compare = (coreEntry) => JSON.parse(execFileSync(process.execPath, [
      fileURLToPath(import.meta.url), '--one', resolve(coreEntry), fixture,
    ], { encoding: 'utf8' }));
    const control = compare(base);
    const reviewed = compare(head);
    console.log('base', JSON.stringify(control));
    console.log('head', JSON.stringify(reviewed));
    const present = { calls: 1, buildId: 'ci-42' };
    assert.deepEqual(control.ordinary, present);
    assert.deepEqual(control.withObserver, present);
    assert.deepEqual(reviewed.ordinary, { calls: 0, buildId: null });
    assert.deepEqual(reviewed.withObserver, present);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
