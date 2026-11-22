# An existing directory symlink is skipped with followSymlinks enabled

Create `src/package` as a directory symlink to a separate workspace package containing `lib/module.js`. Register `src` as a context and `src/generated/missing.js` as a missing dependency to request recursive coverage. Wait for an unrelated registration marker, then write the existing module via its physical path. Observe the linked target's kernel watch, the logical file event and the context invalidation.

| Options and result | Merge base | Reviewed change |
| --- | --- | --- |
| `followSymlinks: true` | Watches the target, reports `src/package/lib/module.js` and invalidates `src` | Target has no watch, both notifications are missing |
| `followSymlinks: false` | Skips the linked subtree | Skips the linked subtree |
| Live edit in an independent registered directory | Delivered | Delivered |

The JavaScript adapter forwards the configured option to the binding. In the new recursive walker the enabled branch calls `DirEntry::metadata()`, which returns metadata for the symlink itself. The subsequent directory check skips that entry. [Rspack option forwarding](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/packages/rspack/src/NativeWatchFileSystem.ts#L421-L434) · [Rspack tree walk](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L346-L361) · [Rust toolchain source](https://github.com/rust-lang/rust/blob/8eb778d04094d3af4b26580cab327e0413eb1e02/library/std/src/fs.rs#L2856-L2861)

## Run the comparison

Use Linux x86-64 with glibc and Node.js 22. Each binding runs in a fresh Node process. The recorded runs used Node.js 22.16.0 on Linux 5.15. The verifier builds its fixture, calls the native binding and checks the live results.

From this case directory, download the two CI artifacts and run the verifier.

```sh
gh run download 44908894098 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45032869139 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

Existing artifacts can be passed as `node verify.mjs /path/to/base.node /path/to/head.node`.

| Build | Revision | Native binding SHA-256 |
| --- | --- | --- |
| [Merge base CI](https://github.com/web-infra-dev/rspack/actions/runs/44908894098) | `0350265fd086a7caf45f1b00796133e5a753153c` | `d90a1be51843e2deff825da25a284d65968e1e6cf15dd0dfcf5f170010a0505f` |
| [PR CI](https://github.com/web-infra-dev/rspack/actions/runs/45032869139/job/137240098206) | `37da9c1c219ff17a58f63e73d36036de072a18be` | `ed2db6b60e84c88629d235f7f0ff3c39e437aea7dcf95cc2b50e3fd98a3b89aa` |

PR CI built a test merge with parents `f2c72390841090fcd329112dc551b423400758d6` (base branch tip) and `1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca` (reviewed PR head). The merge base is `0350265fd086a7caf45f1b00796133e5a753153c`. The test merge and reviewed head have identical Rust sources, Rust toolchain, Cargo manifests and Cargo lockfile. They differ in JavaScript tests and pnpm files. [Test merge](https://github.com/web-infra-dev/rspack/commit/37da9c1c219ff17a58f63e73d36036de072a18be) · [reviewed changes](https://github.com/web-infra-dev/rspack/pull/16803/files)
