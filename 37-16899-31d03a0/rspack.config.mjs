import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.WATCH_FIXTURE;
const out = path.join(root, 'out');
let build = 0;

export default {
  mode: 'development',
  context: root,
  entry: './entry.js',
  devtool: false,
  output: { path: out, filename: 'bundle.js' },
  experiments: { nativeWatcher: true },
  module: { rules: [{ test: /entry\.js$/, use: path.join(import.meta.dirname, 'manifest-loader.cjs') }] },
  watchOptions: { aggregateTimeout: 50 },
  plugins: [{
    apply(compiler) {
      compiler.hooks.done.tap('RecordBuild', stats => {
        if (stats.hasErrors()) throw Error(stats.toString({ all: false, errors: true }));
        const values = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
        const bundle = createHash('sha256').update(fs.readFileSync(path.join(out, 'bundle.js'))).digest('hex');
        fs.appendFileSync(path.join(root, 'builds.jsonl'), JSON.stringify({ build: ++build, values, bundle, at: performance.now() }) + '\n');
      });
    },
  }],
};
