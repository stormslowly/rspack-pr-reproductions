import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const old = new Date("2020-04-05T06:07:08.123Z");
const self = fileURLToPath(import.meta.url);

async function observe(coreFile, root) {
  const { rspack, sources } = await import(pathToFileURL(coreFile));
  const directory = path.join(root, "assets");
  const marker = path.join(directory, "nested", "manifest.txt");
  const entry = path.join(root, "index.js");
  const output = path.join(root, "dist");
  fs.writeFileSync(entry, "module.exports = 1;\n");
  fs.utimesSync(entry, old, old);
  let builds = 0;
  let seen = "initial";
  let edited = false;
  let result;
  let failure;
  const compiler = rspack({
    context: root,
    mode: "development",
    devtool: false,
    entry: "./index.js",
    output: { path: output, filename: "bundle.js" },
    experiments: { nativeWatcher: true },
    plugins: [
      {
        apply(compiler) {
          compiler.hooks.watchRun.tap("ReadContextTimes", () => {
            if (!edited) return;
            const times = compiler.fileTimestamps;
            assert.ok(times instanceof Map);
            seen =
              typeof times.get(marker)?.timestamp === "number"
                ? "present"
                : "missing";
            result ??= {
              manifestAtRebuild: seen,
              editedEntryReported: compiler.modifiedFiles.has(entry),
              contextFiles: [...times.entries()].filter(
                ([name, time]) =>
                  name.startsWith(directory + path.sep) &&
                  typeof time?.timestamp === "number",
              ).length,
            };
          });
          compiler.hooks.thisCompilation.tap("TrackAssets", (compilation) => {
            compilation.hooks.processAssets.tap("TrackAssets", () => {
              compilation.contextDependencies.add(directory);
              compilation.emitAsset(
                "manifest-state.txt",
                new sources.RawSource(seen),
              );
            });
          });
          compiler.hooks.afterEmit.tap("EditDuringFirstBuild", () => {
            if (edited) return;
            edited = true;
            fs.writeFileSync(entry, "module.exports = 2;\n");
          });
        },
      },
    ],
  });
  let handle;
  try {
    handle = compiler.watch({ aggregateTimeout: 50 }, (error, stats) => {
      if (error || stats.hasErrors())
        failure = error ?? new Error(stats.toString({ errors: true }));
      builds++;
      if (builds === 2 && result) {
        result.emitted = fs.readFileSync(
          path.join(output, "manifest-state.txt"),
          "utf8",
        );
      }
    });
    const end = Date.now() + 20000;
    let eventually = false;
    while (Date.now() < end && !(result?.emitted && eventually)) {
      if (failure) throw failure;
      if (result?.emitted) {
        const files = new Map();
        compiler.watchFileSystem.collectTimeInfoEntries(files, new Map());
        eventually = typeof files.get(marker)?.timestamp === "number";
      }
      if (!eventually) await delay(80);
    }
    if (failure) throw failure;
    assert.ok(
      eventually && result?.emitted,
      "the unchanged manifest must eventually be indexed",
    );
    assert.equal(result.editedEntryReported, true);
    await delay(500);
    if (failure) throw failure;
    assert.equal(
      builds,
      2,
      "no additional change was made after the entry edit",
    );
    const stateAfterIdle = fs.readFileSync(
      path.join(output, "manifest-state.txt"),
      "utf8",
    );
    assert.equal(stateAfterIdle, result.emitted);
    fs.writeFileSync(entry, "module.exports = 3;\n");
    const lastBuildDeadline = Date.now() + 10000;
    while (!failure && builds < 3 && Date.now() < lastBuildDeadline)
      await delay(30);
    if (failure) throw failure;
    assert.equal(builds, 3);
    const stateAfterNextEdit = fs.readFileSync(
      path.join(output, "manifest-state.txt"),
      "utf8",
    );
    assert.equal(stateAfterNextEdit, "present");
    return {
      ...result,
      presentAfterScan: eventually,
      stateAfterIdle,
      stateAfterNextEdit,
    };
  } finally {
    if (handle)
      await new Promise((ok, bad) => handle.close((e) => (e ? bad(e) : ok())));
    await new Promise((ok, bad) => compiler.close((e) => (e ? bad(e) : ok())));
  }
}

if (process.argv[2] === "--one") {
  console.log(JSON.stringify(await observe(process.argv[3], process.argv[4])));
} else {
  const base = path.resolve(
    process.argv[2] || "base/rspack.linux-x64-gnu.node",
  );
  const head = path.resolve(
    process.argv[3] || "head/rspack.linux-x64-gnu.node",
  );
  const core = path.resolve(process.argv[4] || "package/dist/index.js");
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "rspack-first-watch-")),
  );
  const directory = path.join(root, "assets");
  const results = { base: [], head: [] };
  try {
    fs.mkdirSync(path.join(directory, "nested"), { recursive: true });
    const marker = path.join(directory, "nested", "manifest.txt");
    fs.writeFileSync(marker, "unchanged");
    fs.utimesSync(marker, old, old);
    for (let i = 0; i < 8192; i++) {
      const filename = path.join(directory, i + ".txt");
      fs.writeFileSync(filename, "");
      fs.utimesSync(filename, old, old);
    }
    fs.utimesSync(path.dirname(marker), old, old);
    fs.utimesSync(directory, old, old);
    await delay(2100);
    const order = ["base", "head", "head", "base", "base", "head"];
    for (const side of order) {
      const json = execFileSync(process.execPath, [self, "--one", core, root], {
        env: { ...process.env, RSPACK_BINDING: side === "base" ? base : head },
        encoding: "utf8",
        timeout: 30000,
      }).trim();
      const observation = JSON.parse(json);
      results[side].push(observation);
      console.log(side, json);
    }
    assert.ok(results.base.every((x) => x.emitted === "present"));
    assert.ok(results.head.every((x) => x.emitted === "missing"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
