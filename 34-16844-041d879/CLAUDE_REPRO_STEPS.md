# A queued directory removal leaves a watched child's timestamp behind

A loader watches `src` as a context, registers the generated directory `src/pages/generated` as a missing dependency, and registers `generated/entry.js` as a file dependency. The directory appears during the build. The watcher queues its discovery. The loader drops the `src` context while retaining the directory and file dependencies. Before notification delivery, a generator moves `pages` out of the tree. The rebuild reports the directory in `compiler.removedFiles`, and both paths are absent from disk.

| On the rebuild that reports the removal | Merge base | Main used by PR CI | Reviewed PR | PR retaining the context |
| --- | --- | --- | --- | --- |
| Directory entry in `compiler.fileTimestamps` | `null` | `null` | `null` | `null` |
| Child entry in `compiler.fileTimestamps` | `null` | `null` | `timestamp: 1600000000123` | `null` |

The PR checks the original scan's context before clearing a removed subtree. Once the context retires, the surviving missing subscription reconciles its own path, leaving the child file's cached record in place. The file snapshot reads that record before falling back to a filesystem stat. The merge base clears the subtree when the directory removal is observed. [Scan guard](https://github.com/web-infra-dev/rspack/blob/041d8793928465cfcb71dd576ed01b2a37e9bfee/crates/rspack_watcher/src/paths.rs#L513-L526) · [Removal handling](https://github.com/web-infra-dev/rspack/blob/041d8793928465cfcb71dd576ed01b2a37e9bfee/crates/rspack_watcher/src/paths.rs#L607-L617) · [File snapshot](https://github.com/web-infra-dev/rspack/blob/041d8793928465cfcb71dd576ed01b2a37e9bfee/crates/rspack_watcher/src/paths.rs#L1352-L1360) · [Merge-base removal handling](https://github.com/web-infra-dev/rspack/blob/84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3/crates/rspack_watcher/src/trigger.rs#L267-L279)

## Run the compiler comparison

Run from this directory on Linux x86-64 with glibc and directory birth-time support. The verifier uses `compiler.watch`, real filesystem moves, and ordinary loader dependencies. A separate directory move and a JavaScript `ignored` predicate hold up event processing long enough for subsequent watch updates to complete. A following registration acts as a barrier before the generator moves the tree. Each comparison starts fresh Node processes.

```sh
npm install --prefix . --no-save --package-lock=false --ignore-scripts @rspack/core@2.3.4
gh run download 45740211560 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D main
gh run download 45749688659 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

Main, the reviewed PR, and the retained-context control gave the same results in five comparisons with Node.js 22.16.0. We also ran the original merge-base binding with its matching JavaScript build. To run an individual binding with a matching core module, use `node verify.mjs --worker /path/to/binding.node retire /path/to/core/dist/index.js`. Passing `keep` retains the context throughout the same move.

| CI binding | Source checked out | Binding SHA-256 |
| --- | --- | --- |
| [Original merge base](https://github.com/web-infra-dev/rspack/actions/runs/45339599582/job/138259974230) | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3` | `5b3dfd4aeb9ce00820edcd2e7f157b9c9043e7b286d645c33a647cce3d50bcbc` |
| [Main before the PR test merge](https://github.com/web-infra-dev/rspack/actions/runs/45740211560/job/139643233982) | `d04c7d790867e3c327fcc06b1f2d51585bd24ba1` | `8863ccafd7c92ba95936a594284db85c0347dd61564205dfbfbe45560b4ef073` |
| [Reviewed PR](https://github.com/web-infra-dev/rspack/actions/runs/45749688659/job/139682524878) | `4d040a7c29a6366d3783f04458d62fd50279000a` | `5a381a6a1dc22a3848d6617b5c3711095c0a9a8c6062570ea71bd81890019ffd` |

The CI test merge has first parent `d04c7d790867e3c327fcc06b1f2d51585bd24ba1` and second parent `041d8793928465cfcb71dd576ed01b2a37e9bfee`. Its production watcher and native watcher binding sources match the reviewed head.
