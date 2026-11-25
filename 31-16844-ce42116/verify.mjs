import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rspack-watcher-path-cmp-'));
const toolchain = 'nightly-2026-11-13';

function check(args) {
  const result = spawnSync('rustup', ['run', toolchain, 'cargo', 'check', '--color', 'never', ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout: 180000,
  });
  if (result.error) throw result.error;
  return result;
}

try {
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'Cargo.toml'), `[package]
name = "watcher-path-comparison"
version = "0.0.0"
edition = "2024"

[dependencies]
rkyv = { version = "=0.7.45", optional = true }
`);
  const original = `#[cfg(feature = "rkyv")]
use rkyv as _;
use std::path::{Path, PathBuf};

fn main() {
    let moved = PathBuf::from("src/generated");
    let path = String::from("src/generated/child.js");
    assert!(Path::new(&path).parent() == Some(&moved));
}
`;
  const main = path.join(project, 'src', 'main.rs');
  fs.writeFileSync(main, original);
  const standalone = check([]);
  assert.equal(standalone.status, 0, standalone.stderr);

  const workspaceComparison = check(['--locked', '--features', 'rkyv']);
  assert.equal(workspaceComparison.status, 101, workspaceComparison.stderr);
  assert.match(workspaceComparison.stderr, /error\[E0277\]/);
  assert.match(workspaceComparison.stderr, /Option<&(?:std::path::)?PathBuf>/);

  fs.writeFileSync(main, original.replace('Some(&moved)', 'Some(moved.as_path())'));
  const explicitPath = check(['--locked', '--features', 'rkyv']);
  assert.equal(explicitPath.status, 0, explicitPath.stderr);
  console.log(JSON.stringify({
    standalone: 'pass',
    withWorkspaceDependency: 'E0277',
    withExplicitPath: 'pass',
  }));
} finally {
  fs.rmSync(project, { recursive: true, force: true });
}
