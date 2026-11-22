# Installing and withdrawing one large recursive watch takes longer on Linux

Create a source root with 1,000, 4,000 or 8,000 existing empty child directories. Add a single missing `src/generated/entry.js` dependency, which requests one recursive root. Withdraw that dependency in the next update. Both versions hold exactly one kernel watch per directory after installation, and zero after withdrawal.

Each sample uses a fresh `NativeWatcher` and the same prepared tree. One warm-up precedes five measurements. An ignored marker in the next FIFO request identifies when the owner has finished the preceding native registration. The clock excludes fixture construction, descriptor counting and watcher shutdown. There is no context scan or compilation in the timed workload.

| Child directories | Base install, ms | PR install, ms | Base withdrawal, ms | PR withdrawal, ms |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 8.52 / 8.91 | 21.36 / 21.02 | 1.51 / 1.58 | 13.23 / 11.53 |
| 4,000 | 37.59 / 36.95 | 80.02 / 82.72 | 6.25 / 5.85 | 54.15 / 53.40 |
| 8,000 | 73.42 / 73.85 | 153.88 / 161.85 | 12.94 / 12.87 | 110.72 / 110.61 |

Each cell gives the five-sample medians from two independent runs on a warm filesystem. This measures the cost of starting to cover a large source tree and withdrawing its last recursive requirement. Each directory now issues a synchronous request to the `notify` event loop when its first owner is added or its last owner is removed. The base delegates each whole-tree operation to that event loop in one request. [All samples](observed.json) · [Rspack acquisition](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L247-L254) · [Rspack release](https://github.com/web-infra-dev/rspack/blob/1eb9e4f821ce4aac26e65f6ec639dfdd3d503dca/crates/rspack_watcher/src/disk_watcher.rs#L257-L275) · [notify 8.2.2 request and acknowledgement](https://github.com/notify-rs/notify/blob/603674a8c7b7dfa396b2cc9925f75606a18bf295/notify/src/inotify.rs#L573-L603)

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
