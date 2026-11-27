# An initial directory scan can trigger another build with identical output

A loader reads two inputs and watches their containing directory with `addContextDependency`. After reading the initial contents it updates both inputs once, before the watcher attaches. One input is directly under the watched directory. The other is two levels down, behind a directory containing 16,000 aged files. The fixture uses native watch with a 50 ms aggregation interval and the default ignore filter.

Both versions catch up and emit a bundle containing both edits. On the PR, the first invalidation arrives earlier. The same scan subsequently reports the deeper change against its original start time, and the compiler runs a third time after it already emitted the updated bundle. The fixture checks both the manifest values and the SHA-256 of the JavaScript file written to disk, and observes a two-second quiet period after the second build. [Per-entry scan notification](https://github.com/web-infra-dev/rspack/blob/31d03a0809c8a865564c69c6b0038ad7228c5346/crates/rspack_watcher/src/paths/scan.rs#L229-L254)

| Three consecutive runs | Builds | First updated bundle after initial build | Third build after initial build |
| --- | --- | --- | --- |
| Base | 2 every time | 173, 176, 177 ms | — |
| PR | 3 every time | 97, 96, 93 ms | 211, 231, 249 ms |

The updated bundle had hash `9ef3e5a75168fd76599f4d0c243f88f3c328f82838dda61b0a6bb0efb0161a16` in all three runs, including the extra build. Registration and directory enumeration speeds affect whether the observations fall into different aggregation intervals.

## Run

Use the JS packages from a checkout of the reviewed revision for both bindings. The project builds these packages with `pnpm install --frozen-lockfile` followed by `pnpm run build:js`. Set `RSPACK_CLI` to the absolute path of `packages/rspack-cli/bin/rspack.js` in that checkout. The verifier supplies the native binding to each CLI process through `NAPI_RS_NATIVE_LIBRARY_PATH`. [Build commands](https://github.com/web-infra-dev/rspack/blob/31d03a0809c8a865564c69c6b0038ad7228c5346/.agents/DEVELOPMENT.md#build)

From this case directory, run the following commands on Linux x86-64 with glibc.

```sh
gh run download 45878746840 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45878746052 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs base/rspack.linux-x64-gnu.node head/rspack.linux-x64-gnu.node
```

## Versions

The comparison ran on Linux x86-64 with glibc 2.36 and Node.js 22.16.0. Both CI jobs built a test merge whose Git tree equals the corresponding reviewed revision.

| Revision | CI checkout and parents | SHA-256 of the Linux GNU binding |
| --- | --- | --- |
| [Base `aac0d26`](https://github.com/web-infra-dev/rspack/commit/aac0d26a0b16dcfd8b89085eeebe0ecf620271a0) | [CI build](https://github.com/web-infra-dev/rspack/actions/runs/45878746840/job/140123962062) at `09c73233c560a49da858b3412f814f1eb181685a`, parents `3d7defb03ab020537a6d0a2da71d5bb7255dc492` and `aac0d26a0b16dcfd8b89085eeebe0ecf620271a0` | `43d5aa5802ed8ac28810a91e74d7a8fe00bcf11358a47e74f1eaff308f29ff58` |
| [PR `31d03a0`](https://github.com/web-infra-dev/rspack/commit/31d03a0809c8a865564c69c6b0038ad7228c5346) | [CI build](https://github.com/web-infra-dev/rspack/actions/runs/45878746052/job/140121847789) at `f80288636f1e8b138c1472cfbd5ae37265d1f127`, parents `aac0d26a0b16dcfd8b89085eeebe0ecf620271a0` and `31d03a0809c8a865564c69c6b0038ad7228c5346` | `ff80d89120a9e316c67c1b7aef864dc605b5563c702ba0b8f8ba75c532d881a7` |
