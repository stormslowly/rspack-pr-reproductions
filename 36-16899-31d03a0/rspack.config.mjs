import fs from 'node:fs';
import path from 'node:path';

const root = process.env.WATCH_FIXTURE;
const src = path.join(root, 'src');
const control = path.join(root, 'control');
const count = Number(process.env.WATCH_NOISE_COUNT);
const before = new Set();
const after = new Set();

export default {
  mode: 'development',
  context: root,
  entry: path.join(src, 'entry.js'),
  devtool: false,
  output: { path: path.join(root, 'out'), filename: 'bundle.js' },
  experiments: { nativeWatcher: true },
  module: { rules: [{ test: /entry\.js$/, use: path.join(import.meta.dirname, 'slow-loader.cjs') }] },
  watchOptions: {
    aggregateTimeout: 20,
    ignored(file) {
      if (file === path.join(control, 'resume-input')) fs.writeFileSync(path.join(control, 'resuming'), '');
      if (path.dirname(file) !== src) return false;
      const name = path.basename(file);
      if (name.startsWith('noise-')) {
        if (fs.existsSync(path.join(control, 'building'))) {
          const calls = fs.existsSync(path.join(control, 'release')) ? after : before;
          calls.add(name);
          if (calls === before && before.size === count) fs.writeFileSync(path.join(control, 'seen'), '');
        }
        return true;
      }
      if (name === 'ready-probe') fs.writeFileSync(path.join(control, 'ready'), '');
      if (name === 'after-probe' && fs.existsSync(path.join(control, 'capture'))) {
        fs.writeFileSync(path.join(control, 'counts'), JSON.stringify([before.size, after.size]));
      }
      return name.endsWith('-probe');
    },
  },
};
