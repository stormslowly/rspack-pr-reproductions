import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const target = "wasm32-wasip1-threads";
const [base, head] = process.argv.slice(2);
assert.ok(base && head, "usage: node verify.mjs BASE_CHECKOUT HEAD_CHECKOUT");

function check(checkout, sha) {
  const cwd = resolve(checkout);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();
  assert.equal(revision, sha);
  const targetDir = resolve(
    process.env.CARGO_TARGET_DIR || resolve(cwd, "target"),
    "pr-16935",
    sha,
  );
  const run = spawnSync(
    "cargo",
    [
      "check",
      "-Zbuild-std=std,panic_abort",
      "--locked",
      "-p",
      "rspack_watcher",
      "--target",
      target,
    ],
    {
      cwd,
      env: { ...process.env, CARGO_TARGET_DIR: targetDir },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (run.error) throw run.error;
  return { status: run.status, log: run.stdout + run.stderr };
}

const control = check(base, "15ba844c2da0d8ff0ebbcd0e54fe929b06ab3de2");
if (control.status !== 0) process.stderr.write(control.log);
assert.equal(
  control.status,
  0,
  "the control must compile with the same toolchain and target",
);
console.log("base: cargo check exited 0");

const candidate = check(head, "d5a236e19b630d5ebe69071b7f02c308617df803");
const diagnostic = candidate.log.match(
  /error\[E0317\]:[^\n]*\n\s*-->\s*crates\/rspack_watcher\/src\/watcher_manager\.rs:\d+:\d+/,
);
if (!diagnostic) process.stderr.write(candidate.log);
assert.equal(candidate.status, 101);
assert.ok(
  diagnostic,
  "expected the target-specific compiler error in normalize_dir_path",
);
console.log("head: cargo check exited 101\n" + diagnostic[0]);
