# A rebuild can expose incomplete file timestamps from a new context

A plugin registers an assets directory as a context dependency and reads an existing nested manifest's timestamp in `watchRun`. It writes the observed state into an asset. There are 8,192 unchanged sibling files and one nested manifest. An edit to the JavaScript entry lands at the end of the initial compilation, before the first watch is installed. The manifest and its directory stay on disk throughout the run. Ordinary filesystem operations drive all changes.

## Run on Linux

Use Linux x86-64 with glibc and Node.js 22. Run the following commands in this case directory.

```sh
gh run download 45964163488 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45974918126 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
npm pack @rspack-canary/core@2.3.5-canary-56ed00d7-20261126172159 --ignore-scripts --registry=https://registry.npmjs.org
tar -xzf rspack-canary-core-2.3.5-canary-56ed00d7-20261126172159.tgz
node verify.mjs
```

## Versions

| Component | Revision |
| --- | --- |
| [Base Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/45964163488/artifacts/15181493502) | The actual merge base `4dff634eef4acfeac44156d2a44eef80af0985f7` |
| [PR Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/45974918126/artifacts/15187417068) | Test merge `1f8a6b9ec6a9be5301fe3ed48942277b0297535b` |
| [Reviewed head](https://github.com/web-infra-dev/rspack/pull/16917) | `bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60` |

The test merge combines first parent `9e9e63d5c7eafcb4374b2875a633e567fb263c3c` with the reviewed head as second parent. The five differences between that merge and the head affect JavaScript stats or its tests. All Rust source is identical. [Compare the head and test merge](https://github.com/web-infra-dev/rspack/compare/bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60...1f8a6b9ec6a9be5301fe3ed48942277b0297535b)

Both runs load the same JavaScript compiler from canary `56ed00d769842dffb13b4c03477da8f3cacf3fba`. Its `Watching.ts`, native watch file system and watch-time helper match the merge base and the reviewed head. [Compiler timestamp handling](https://github.com/web-infra-dev/rspack/blob/bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60/packages/rspack/src/Watching.ts#L317-L340)

## Observed with Node.js 22.16.0

Each side ran three times in a fresh compiler process on the same Linux machine, alternating execution order. The entry edit triggered every rebuild. All compilations succeeded.

| Read by the first rebuild | Base | PR |
| --- | --- | --- |
| File timestamps inside the assets directory (8,193 files) | 8,193 in all three runs | 3,019 / 3,039 / 3,078 |
| Manifest state written to the output | `present` throughout | `missing` in all three runs |
| Same output 500 ms after the live snapshot included the manifest | `present` | `missing` |
| Output following a second real entry edit | `present` | `present` |

The baseline finishes indexing new contexts before it starts the explicit-path scan. On the PR, handlers are already installed and the explicit scan runs alongside directory enumeration. Its entry change can start the next compilation while the nested manifest still has no timestamp. Completing the scan of an unchanged file does not by itself invalidate the output. The exact number of files indexed before the callback depends on scheduling. [Baseline ordering](https://github.com/web-infra-dev/rspack/blob/4dff634eef4acfeac44156d2a44eef80af0985f7/crates/rspack_watcher/src/lib.rs#L462-L479) · [PR ordering](https://github.com/web-infra-dev/rspack/blob/bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60/crates/rspack_watcher/src/lib.rs#L497-L504)
