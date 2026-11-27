const fs = require('node:fs');
const path = require('node:path');

module.exports = function () {
  this.cacheable(false);
  const watched = path.join(process.env.WATCH_FIXTURE, 'watched');
  this.addContextDependency(watched);
  const files = [path.join(watched, 'first.txt'), path.join(watched, 'pages', 'deep', 'last.txt')];
  const values = files.map(file => fs.readFileSync(file, 'utf8'));
  if (values[0] === 'old-first') {
    fs.writeFileSync(files[0], 'new-first');
    fs.writeFileSync(files[1], 'new-last');
  }
  this.emitFile('manifest.json', JSON.stringify(values));
  return 'module.exports = ' + JSON.stringify(values) + ';';
};
