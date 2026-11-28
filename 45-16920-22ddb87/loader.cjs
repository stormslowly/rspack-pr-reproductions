const path = require("node:path");

module.exports = function trackManifest(source) {
  const assets = path.join(this.rootContext, "assets");
  this.cacheable(false);
  this.addContextDependency(assets);
  if (source.includes("/* track missing manifest */")) {
    this.addMissingDependency(path.join(assets, "generated", "manifest.json"));
  }
  return source;
};
