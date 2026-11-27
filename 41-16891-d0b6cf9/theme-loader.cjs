const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

module.exports = async function themeLoader() {
  const resolve = this.getOptions().api === 'this.resolve'
    ? promisify(this.resolve.bind(this))
    : this.getResolve();

  let theme;
  try {
    theme = await resolve(this.context, './preferred-theme.js');
  } catch (error) {
    fs.writeFileSync(path.join(this.context, 'observed-code.txt'), String(error.code));
    if (error.code !== 'GenericFailure') throw error;
    theme = await resolve(this.context, './default-theme.js');
  }
  return `module.exports = require(${JSON.stringify(theme)});`;
};
