const fs = require('node:fs');
const path = require('node:path');
const { setTimeout } = require('node:timers/promises');

module.exports = function (source) {
  if (!source.includes('BUILD_IN_PROGRESS')) return source;
  const done = this.async();
  const control = path.join(process.env.WATCH_FIXTURE, 'control');
  this.addDependency(path.join(control, 'resume-input'));
  fs.writeFileSync(path.join(control, 'building'), '');
  async function waitForRelease() {
    while (!fs.existsSync(path.join(control, 'release'))) await setTimeout(5);
    return source;
  }
  waitForRelease().then(value => done(null, value), done);
};
