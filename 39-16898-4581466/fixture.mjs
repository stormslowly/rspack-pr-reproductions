import fs from 'node:fs';
import path from 'node:path';

export const moduleCount = 8192;
export const initialMarker = 'WATCH_INITIAL_VALUE';

export function writeProject(root) {
  function write(relativePath, source) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    fs.utimesSync(file, 1600000000.123, 1600000000.123);
  }

  const groups = new Map();
  for (let i = 0; i < moduleCount; i++) {
    const group = 'group-' + (i % 128);
    const name = 'module-' + i;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push('require("./' + name + '")');
    write('src/' + group + '/' + name + '.ts', 'module.exports = ' + i + ';');
  }
  const entryImports = ['require("./stamp")'];
  for (const [group, imports] of groups) {
    write('src/' + group + '/barrel.js', 'module.exports = [' + imports.join(',') + '];');
    entryImports.push('require("./' + group + '/barrel")');
  }
  write('src/index.js', 'module.exports = [' + entryImports.join(',') + '];');
}

export function writeMarker(root, value) {
  const marker = path.join(root, 'src', 'stamp.js');
  fs.writeFileSync(marker, 'module.exports = "' + value + '";');
  if (value === initialMarker) fs.utimesSync(marker, 1600000000.123, 1600000000.123);
}

export function median(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
}
