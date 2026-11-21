import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const engine = process.argv[2];
if (!engine) throw new Error('Pass webpack or the path to an Rspack .node binding.');
const useWebpack = engine === 'webpack';
if (!useWebpack) {
  process.env.RSPACK_BINDING = realpathSync(resolve(engine));
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = process.env.RSPACK_BINDING;
}
const bundle = useWebpack ? require('webpack') : require('@rspack-canary/core').rspack;
const fixture = join(import.meta.dirname, 'fixture');
const output = mkdtempSync(join(tmpdir(), 'rspack-review-'));
const compiler = bundle({
  context: fixture,
  mode: 'development',
  target: 'web',
  devtool: false,
  entry: './src/index.js',
  resolve: {
    aliasFields: ['browser'],
    preferRelative: true,
  },
  output: { path: output, filename: 'bundle.cjs', library: { type: 'commonjs2' } },
});

try {
  const issuer = join(fixture, 'src');
  const syncOptions = useWebpack ? { useSyncFileSystemCalls: true } : {};
  const resolver = compiler.resolverFactory.get('normal', syncOptions);
  function lookup(request) {
    const result = resolver.resolveSync({}, issuer, request);
    return result === false ? false : relative(fixture, result).split(sep).join('/');
  }
  const resolved = lookup('transport');
  const directIgnored = lookup('./transport.js');
  const directBrowser = lookup('../browser.js');
  const stats = await promisify(compiler.run).call(compiler);
  if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
  if (!useWebpack && !require.cache[process.env.RSPACK_BINDING]) {
    throw new Error('The requested CI binding was not loaded.');
  }
  const bundled = require(join(output, 'bundle.cjs'));
  console.log(JSON.stringify({ resolved, bundled, directIgnored, directBrowser }));
} finally {
  await promisify(compiler.close).call(compiler);
  rmSync(output, { recursive: true, force: true });
}
