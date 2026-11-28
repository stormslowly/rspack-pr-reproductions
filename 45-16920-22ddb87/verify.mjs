import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
const age = new Date("2020-04-05T06:07:08.125Z");
async function observe(coreFile, mode) {
  const { rspack, sources } = await import(pathToFileURL(coreFile));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rspack-loader-context-"));
  const dir = path.join(root, "assets"),
    moved = path.join(dir, "generated"),
    staging = path.join(root, "staging"),
    leaf = path.join(moved, "manifest.json"),
    sibling = path.join(moved, "other.json"),
    seed = path.join(dir, "seed"),
    entry = path.join(root, "index.js"),
    output = path.join(root, "dist");
  let watcher,
    compiler,
    build = 0,
    completed = 0,
    scanStarted = false,
    movedIn = false,
    failure,
    visits = 0;
  const registrations = [];
  const sleepCell = new Int32Array(new SharedArrayBuffer(4));
  const checks = [];
  const wait = async (fn, label) => {
    const stop = Date.now() + 10000;
    while (!fn()) {
      if (failure) throw failure;
      if (Date.now() > stop)
        throw Error(
          "Timeout " +
            label +
            " build=" +
            build +
            " completed=" +
            completed +
            " checks=" +
            JSON.stringify(checks),
        );
      await delay(5);
    }
  };
  const snapshot = () => {
    const files = new Map();
    compiler.watchFileSystem.collectTimeInfoEntries(files, new Map());
    return files;
  };
  try {
    fs.mkdirSync(dir);
    fs.mkdirSync(staging);
    for (const name of [
      "manifest.json",
      "other.json",
      ...Array.from({ length: 64 }, (_, i) => i + ".json"),
    ]) {
      fs.writeFileSync(path.join(staging, name), "{}");
      fs.utimesSync(path.join(staging, name), age, age);
    }
    fs.writeFileSync(seed, "seed");
    fs.utimesSync(seed, age, age);
    fs.utimesSync(dir, age, age);
    fs.writeFileSync(
      entry,
      "module.exports = 0; /* track missing manifest */\n",
    );
    fs.utimesSync(entry, age, age);
    const loader = fileURLToPath(new URL("./loader.cjs", import.meta.url));
    compiler = rspack({
      context: root,
      mode: "development",
      entry: "./index.js",
      devtool: false,
      module: { rules: [{ test: /index\.js$/, use: [loader] }] },
      output: { path: output, filename: "bundle.js" },
      experiments: { nativeWatcher: true },
      plugins: [
        {
          apply(c) {
            c.hooks.watchRun.tap("ReadTimes", () => {
              build++;
              if (build >= 3)
                checks.push({
                  build,
                  leafKey: c.fileTimestamps?.has(leaf) ?? false,
                  leaf: c.fileTimestamps?.get(leaf)?.timestamp ?? null,
                  sibling: c.fileTimestamps?.get(sibling)?.timestamp ?? null,
                  contextChange: c.modifiedFiles?.has(dir) ?? false,
                });
            });
            c.hooks.thisCompilation.tap("TrackManifest", (compilation) => {
              compilation.hooks.processAssets.tap("TrackManifest", () => {
                const row = checks.at(-1);
                compilation.emitAsset(
                  "manifest-state.txt",
                  new sources.RawSource(row?.leaf ? "present" : "missing"),
                );
              });
            });
            c.hooks.afterEmit.tapPromise("InstallGeneratedFiles", async () => {
              if (build !== 2 || movedIn) return;
              movedIn = true;
              fs.renameSync(staging, moved);
              await wait(() => scanStarted, "directory enumeration to start");
            });
          },
        },
      ],
    });
    const fsWatch = compiler.watchFileSystem.watch.bind(
      compiler.watchFileSystem,
    );
    compiler.watchFileSystem.watch = (f, d, m, ...rest) => {
      registrations.push({
        build,
        missing: m.has ? m.has(leaf) : [...m].includes(leaf),
        removed: [...(m.removed ?? [])].includes(leaf),
        visits,
      });
      return fsWatch(f, d, m, ...rest);
    };
    watcher = compiler.watch(
      {
        aggregateTimeout: 25,
        ignored(name) {
          if (movedIn && path.dirname(name) === moved) {
            scanStarted = true;
            visits++;
            if (visits <= 66) Atomics.wait(sleepCell, 0, 0, 1);
          }
          return false;
        },
      },
      (e, stats) => {
        if (e || stats.hasErrors())
          failure =
            e ?? new Error(stats.toString({ all: false, errors: true }));
        completed++;
      },
    );
    await wait(
      () =>
        completed >= 1 &&
        compiler.watchFileSystem.watcher &&
        snapshot().has(seed) &&
        snapshot().get(leaf) === null,
      "initial watch",
    );
    fs.writeFileSync(
      entry,
      mode === "retain"
        ? "module.exports = 1; /* track missing manifest */\n"
        : "module.exports = 1;\n",
    );
    await wait(
      () => completed >= 3 && checks.some((x) => x.sibling),
      "rebuild after the move",
    );
    const first = checks.find((x) => x.sibling);
    const asset = fs.readFileSync(
      path.join(output, "manifest-state.txt"),
      "utf8",
    );
    const buildsBeforeEdit = build;
    fs.writeFileSync(entry, "module.exports = 2;\n");
    await wait(() => completed > buildsBeforeEdit, "another entry rebuild");
    assert.equal(fs.statSync(leaf).mtimeMs, age.getTime());
    const second = registrations.find((r) => r.build === 2);
    assert.ok(
      second && second.visits > 0 && second.visits < 66,
      "the watch update must overlap the directory scan",
    );
    assert.equal(second.removed, mode === "retire");
    assert.equal(first.sibling, age.getTime());
    assert.equal(first.contextChange, true);
    return {
      leafKey: first.leafKey,
      asset,
      afterIndependentEdit: checks.at(-1).leaf,
      assetAfterIndependentEdit: fs.readFileSync(
        path.join(output, "manifest-state.txt"),
        "utf8",
      ),
      filesVisitedAtWatchUpdate: second.visits,
    };
  } finally {
    if (watcher)
      await new Promise((ok, bad) => watcher.close((e) => (e ? bad(e) : ok())));
    if (compiler)
      await new Promise((ok, bad) =>
        compiler.close((e) => (e ? bad(e) : ok())),
      );
    fs.rmSync(root, { recursive: true, force: true });
  }
}
if (process.argv[2] === "--one") {
  console.log(JSON.stringify(await observe(process.argv[3], process.argv[4])));
} else {
  const base = path.resolve(
      process.argv[2] || "base/rspack.linux-x64-gnu.node",
    ),
    head = path.resolve(process.argv[3] || "head/rspack.linux-x64-gnu.node"),
    core = path.resolve(process.argv[4] || "package/dist/index.js");
  for (const mode of ["retire", "retain"])
    for (const side of ["base", "head", "head", "base", "base", "head"]) {
      const out = execFileSync(process.execPath, [self, "--one", core, mode], {
        encoding: "utf8",
        env: { ...process.env, RSPACK_BINDING: side === "base" ? base : head },
        timeout: 40000,
      });
      const result = JSON.parse(out);
      console.log(mode, side, JSON.stringify(result));
      const expected =
        side === "head" && mode === "retire" ? "missing" : "present";
      assert.equal(result.asset, expected);
      assert.equal(result.leafKey, expected === "present");
      assert.equal(
        result.afterIndependentEdit,
        expected === "present" ? age.getTime() : null,
      );
      assert.equal(result.assetAfterIndependentEdit, expected);
    }
}
