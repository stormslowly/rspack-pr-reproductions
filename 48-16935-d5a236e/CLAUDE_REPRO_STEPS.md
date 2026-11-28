# The watcher fails to compile for the WASI binding target

Compile the real `rspack_watcher` crate for `wasm32-wasip1-threads`, the target used by the Rspack WASM binding. Rust sets `target_family="wasm"` and `target_os="wasi"` for it. The new `normalize_dir_path` only provides a tail expression under `cfg(windows)` or `cfg(unix)`, so the function fails to type-check on this target.

## Repeat

Use a Rspack checkout with the following commits available. From this case directory, set `repo` to that checkout. The verifier uses the toolchain pinned by each revision, its `rust-src` component, and a separate Cargo output directory for each SHA.

```sh
git -C "$repo" fetch origin main refs/pull/16935/head
work=$(mktemp -d)
git -C "$repo" worktree add --detach "$work/base" 15ba844c2da0d8ff0ebbcd0e54fe929b06ab3de2
git -C "$repo" worktree add --detach "$work/head" d5a236e19b630d5ebe69071b7f02c308617df803
node verify.mjs "$work/base" "$work/head"
```

The verifier runs `cargo check -Zbuild-std=std,panic_abort --locked -p rspack_watcher --target wasm32-wasip1-threads` in each checkout. Building the standard library from the pinned source makes this check independent of whether the prebuilt target has been installed.

| Revision | Expected | Observed |
| --- | --- | --- |
| Merge base `15ba844` | Compiles | Exit 0 |
| PR head `d5a236e` | Compiles | Exit 101, E0317 at `crates/rspack_watcher/src/watcher_manager.rs:25:3` |

The comparison ran on x86-64 Linux with Node.js 22.22.3 and rustc 1.102.0-nightly (`8eb778d04`). The [full PR binding build](https://github.com/web-infra-dev/rspack/actions/runs/46162485613/job/141032820944) fails with the same diagnostic. Its test merge is `a6e5daa07832d310d767b2664b79f28b1990ef95`, with parents `2ad0fabd41d9938ad3446dac95c8cf9d3ddd7bb9` and `d5a236e19b630d5ebe69071b7f02c308617df803`. The [full merge-base build](https://github.com/web-infra-dev/rspack/actions/runs/45994103736/job/140489248169) succeeded.
