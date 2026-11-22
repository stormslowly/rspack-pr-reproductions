# A failed repair drops an established recursive watch after the error clears

Register a directory context `src` and a missing `src/generated/entry.js` so the backend watches `src` recursively. Confirm that `src/good` already has a kernel watch. Create a new child `src/incoming` that the watcher cannot attach. The verifier tests each failure in a fresh process.

1. Create the new directory with mode `0111` as an unprivileged user. Later restore mode `0755`.
2. In a private Linux user and mount namespace, set the local inotify watch quota to 3. The two original source directories and an independent control directory occupy those slots. Later raise the local quota to 8.

After a control edit confirms that the earlier directory event was processed, make another watch request. Record its error and the existing kernel watches. Clear the underlying error, wait for a marker from a successful subsequent registration, then edit an existing file in `src/good`.

| Observation | Merge base | Reviewed change |
| --- | --- | --- |
| Existing source tree after the failing repair | Still watched | Original watches released |
| Subsequent registration after the permission or quota is restored | Succeeds | Succeeds |
| Edit in `src/good` delivers a file event and invalidates `src` | Yes | No |
| Edit in an independent control directory | Delivered | Delivered |

The rollback releases all directories owned by the previously established root and clears its incomplete flag. The active-pattern table still records a successful recursive registration. A later update can skip the root after the underlying error has cleared. [Rollback of existing coverage](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L404-L414) · [up-to-date check](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L173-L186)

Run this case as a regular user on a host that allows unprivileged user namespaces and provides util-linux `unshare`. The worker checks that the user namespace differs from its parent's before writing the per-namespace quota.

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
