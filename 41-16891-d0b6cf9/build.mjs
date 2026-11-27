import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const [checkout, api] = process.argv.slice(2);
const core = path.resolve(checkout, 'packages/rspack/dist/index.js');
const { rspack } = await import(pathToFileURL(core));
const fixture = await mkdtemp(path.join(os.tmpdir(), 'rspack-resolve-code-'));
try {
  await writeFile(path.join(fixture, 'entry.theme'), '');
  await writeFile(path.join(fixture, 'default-theme.js'), 'module.exports = "DEFAULT";\n');
  const compiler = rspack({
    context: fixture,
    mode: 'development',
    target: 'node',
    devtool: false,
    entry: './entry.theme',
    output: {
      path: path.join(fixture, 'dist'),
      filename: 'output.cjs',
      library: { type: 'commonjs2' },
    },
    optimization: { emitOnErrors: false },
    module: {
      rules: [{
        test: /\.theme$/,
        type: 'javascript/auto',
        loader: fileURLToPath(new URL('./theme-loader.cjs', import.meta.url)),
        options: { api },
      }],
    },
  });
  try {
    const stats = await promisify(compiler.run.bind(compiler))();
    const errors = stats.toJson({ all: false, errors: true }).errors.map((error) => error.message);
    const code = await readFile(path.join(fixture, 'observed-code.txt'), 'utf8');
    const tracksPreferred = stats.compilation.missingDependencies.has(path.join(fixture, 'preferred-theme.js'));
    const bundle = path.join(fixture, 'dist/output.cjs');
    const output = existsSync(bundle) ? createRequire(import.meta.url)(bundle) : null;
    console.log(JSON.stringify({ code, errors, output, tracksPreferred }));
  } finally {
    await promisify(compiler.close.bind(compiler))();
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
}
