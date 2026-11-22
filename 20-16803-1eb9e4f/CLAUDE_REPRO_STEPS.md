# Collecting an unclosed native watcher leaves its inotify instance open

Create and explicitly close one native watcher and verify that the inotify instance count returns to its initial value. Next construct eight more native watchers, retain only JavaScript weak references, advance event-loop turns and force garbage collection. No files or user callbacks are registered. Count live JavaScript objects with `WeakRef` and kernel instances with `/proc/self/fd` in the same process.

| Result | Merge base | Reviewed change |
| --- | ---: | ---: |
| New inotify instances before collection | 8 | 8 |
| Live JavaScript watcher objects after collection | 0 | 0 |
| Remaining new inotify instances | 0 | 8 |
| Explicit close releases the control instance | Yes | Yes |

The verifier launches a Node subprocess with `--expose-gc` for each version. This case applies to wrappers abandoned without explicit shutdown, including partial initialization. The backend callback owns the trigger, and the trigger now holds a strong reference back to the disk watcher. Explicit close takes the backend out of this cycle. [Strong reference from the trigger](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/lib.rs#L211-L215) · [backend callback](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L49-L65) · [explicit close](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L218-L221)

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
