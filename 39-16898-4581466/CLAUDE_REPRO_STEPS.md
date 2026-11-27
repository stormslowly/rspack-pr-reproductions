# Reading watcher timestamps takes longer on a large TypeScript module graph

With native watching enabled, a single edited file starts a rebuild that reads timestamps for every registered file and missing dependency. The base reads each record using its interned file path. The PR derives and interns the parent path, looks up the directory watcher, and looks for the file in that watcher. The extra work also applies to candidate filenames that the resolver tried and found missing. [Changed lookup](https://github.com/web-infra-dev/rspack/blob/4581466da2a4d095cdb3a51809812b3088f7bdff/crates/rspack_watcher/src/paths/time_info.rs#L124-L131) · [Registered files and misses](https://github.com/web-infra-dev/rspack/blob/4581466da2a4d095cdb3a51809812b3088f7bdff/crates/rspack_watcher/src/paths/time_info.rs#L333-L358) · [Timestamp consumption before `watchRun`](https://github.com/web-infra-dev/rspack/blob/4581466da2a4d095cdb3a51809812b3088f7bdff/packages/rspack/src/Watching.ts#L316-L342)

## Input and result

The fixture imports 8,192 modules without filename extensions from 128 directories. The resolver tries `.js`, `.jsx`, `.json`, and `.ts` in that order. Rspack registers the dependencies itself. On the verification machine, the snapshot contained 8,322 present files, 33,029 missing paths, and zero contexts on both revisions.

The expected outcome of this storage refactor is comparable snapshot time for the same dependency set. Each run repeatedly edited the same leaf module, waited for the filesystem notification, and verified that the bundle contained the new value. The table gives medians in milliseconds from four fresh Node.js processes in execution order. Snapshot capture measures the synchronous `Watcher.getInfo()` call before reading its lazy JavaScript maps. The other two timings come from the actual rebuilds.

| Revision | Snapshot capture | Aggregated event to `watchRun` | Edit to build callback |
| --- | ---: | ---: | ---: |
| Base, first run | 11.29 | 49.97 | 133.66 |
| PR, first run | 17.83 | 56.42 | 143.62 |
| PR, second run | 18.44 | 56.67 | 145.30 |
| Base, second run | 11.57 | 51.46 | 139.23 |

Each process contributed 16 measured file edits and 18 separate reads of the idle watch handle after warmup. Both revisions emitted the expected content after every edit. The verifier checks that all runs return the same dependency counts and that the faster PR snapshot median exceeds the slower base median by at least 20%. The rebuild timings show the effect on this machine and module graph.

## Run

Use Linux x86-64 with glibc and Node.js 22. The same built JavaScript packages serve both runs. In a Rspack checkout at `9efdfb10cb8197879a1b8466483a76799fba8973` or `4581466da2a4d095cdb3a51809812b3088f7bdff`, run `pnpm install --frozen-lockfile` and `pnpm run build:js`. Set `RSPACK_CORE` to the absolute path of `packages/rspack/dist/index.js` in that checkout. [Rspack build commands](https://github.com/web-infra-dev/rspack/blob/4581466da2a4d095cdb3a51809812b3088f7bdff/.agents/DEVELOPMENT.md#build)

From this case directory run

```sh
gh run download 45926730970 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45928354310 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
export RAYON_NUM_THREADS=4 TOKIO_WORKER_THREADS=2
node verify.mjs base/rspack.linux-x64-gnu.node head/rspack.linux-x64-gnu.node
```

## Versions

Verification used Node.js 22.16.0, glibc 2.36, and four Linux logical CPUs. The CI build jobs checked out the exact revisions below.

| Revision | Linux GNU binding SHA-256 |
| --- | --- |
| [Base `9efdfb10cb8197879a1b8466483a76799fba8973`](https://github.com/web-infra-dev/rspack/actions/runs/45926730970/job/140269669651) | `dc14acadb956661e61004d512511821464d96949a4b430d804336d6b620e6cbc` |
| [PR `4581466da2a4d095cdb3a51809812b3088f7bdff`](https://github.com/web-infra-dev/rspack/actions/runs/45928354310/job/140274952437) | `eee94481637e9719c21f91139cb63aab8626a48501e7abfd077c3067ab715deb` |

The PR workflow used the definition from GitHub's test merge `6b8833a521991d389c29b69190c0722d0f8898b5`, whose parents are the base and PR revisions in the table. The build step explicitly checked out the PR head.
