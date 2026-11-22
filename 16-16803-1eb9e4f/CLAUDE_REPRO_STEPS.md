# Replacing a watched directory under the same name loses later edits

Register `src` as a directory context first. In a subsequent registration, add a missing `src/unresolved/entry.js` to upgrade its backend root to recursive. Verify that both versions watch a new sibling directory before the replacement. This order gives the baseline a deterministic recursive registration. Create the original and replacement directories before the watch so they have demonstrably different inodes. The test exercises two ways that generated source trees are replaced.

1. Also register `src/generated/entry.js` as a file dependency. Delete the old directory, wait for events in a separate control directory, and move the prepared replacement into the original path.
2. In a fresh process, rename a prepared nonempty directory over an existing empty `src/generated` in one filesystem operation. Only the enclosing directory context and the missing dependency refer to the tree.

In both cases, wait for another watch registration to succeed, clear the recorded events, and edit a pre-existing file in the replacement. Inspect its physical directory's inode in `/proc/self/fdinfo`.

| Observation | Merge base | Reviewed change |
| --- | --- | --- |
| New directory inode watched immediately and after another registration | Yes | No |
| Live edit delivers the file event and invalidates `src` | Yes | No |
| Editing the retained explicit dependency in the first case delivers its own event | Yes | No |
| Independent control edit and registration callbacks | Delivered, no errors | Delivered, no errors |

The implementation uses path membership to reuse a physical registration. In the first case a shallow reference survives deletion and allows acquisition to succeed before the new inode is watched. In the atomic case the path still exists when the removal is processed, and the recursive owner still lists it. [Physical reference reuse](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L247-L254) · [recursive ownership check](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L314-L325) · [removal handling](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L450-L475)

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
