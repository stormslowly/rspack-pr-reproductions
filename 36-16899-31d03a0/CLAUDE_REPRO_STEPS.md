# Already ignored files are filtered a second time when watch resumes

An entry module starts a rebuild in native watch mode. Its asynchronous loader waits while 4,096 pre-existing sibling files get an attribute change each. The same JavaScript `watchOptions.ignored` function returns `true` for every one. The loader adds a separate dependency, which the verifier uses to identify when registration resumes. It then edits the source and waits for the updated bundle. No sleeps are added to the predicate.

Both versions first call the predicate for every ignored path. On resume the PR runs the predicate again for all 4,096 paths before the event worker can deliver the next source edit. On base the count of paths checked again is zero. The verifier counts distinct filenames and checks the bundle from the final edit in every run. [Paused input publication](https://github.com/web-infra-dev/rspack/blob/31d03a0809c8a865564c69c6b0038ad7228c5346/crates/rspack_watcher/src/trigger.rs#L668-L673) · [Replay through the same processor](https://github.com/web-infra-dev/rspack/blob/31d03a0809c8a865564c69c6b0038ad7228c5346/crates/rspack_watcher/src/trigger.rs#L693-L701)

| Three consecutive runs | Rechecked distinct paths on resume | Edit to updated bundle |
| --- | --- | --- |
| Base | 0 in every run | 31, 31, 31 ms |
| PR | 4,096 in every run | 134, 113, 124 ms |

The comparison asserts the callback counts. Timings describe this workload and machine.

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
