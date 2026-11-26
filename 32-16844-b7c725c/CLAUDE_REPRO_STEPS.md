# The compiler reports a restored directory as missing after its context unsubscribes

A loader keeps `src/pages/restored` in its missing dependencies across builds. A second build temporarily adds `src` as a context. A generator replaces the `pages` directory with a staged tree containing `restored`, whose birth time is new and whose mtime was preserved. The context scan correctly notifies the compiler about both paths. When the loader drops only the context, the next rebuild exposes the difference.

| Observed after dropping the context | Main used by PR CI | Reviewed PR |
| --- | --- | --- |
| On-disk mtime of the existing directory | 1600000000123 | 1600000000123 |
| `compiler.fileTimestamps.get(target)` | Entry with `timestamp: 1600000000123` | `null` |
| Native timestamp after a real `chmod` | 1600000000123 | `null` |

All five compiler comparisons gave this result. The original merge-base binding also exported the correct timestamp. Creating the child directly in the original watched parent was a working control on the PR. On Linux, swapping the parent leaves the old watch on the previous directory while the new context discovers the restored child. The verifier uses real filesystem operations.

The PR records the restored mtime as `reported` for event deduplication. The exported time is stored separately in `FileRecord.time`. Because the missing dependency was already registered, the separate scan of newly added missing paths does not seed its timestamp. While the context is active it still supplies an existence entry. Once the context is gone, the missing dependency has no exported time. A later same-mtime event is now suppressed. On the earlier `ce42116` build, the missing timestamp recovered after the `chmod`. [Baseline write](https://github.com/web-infra-dev/rspack/blob/b7c725c5ca805ea5a4e369c2690d39be047f3028/crates/rspack_watcher/src/paths.rs#L566-L577) · [Snapshot read](https://github.com/web-infra-dev/rspack/blob/b7c725c5ca805ea5a4e369c2690d39be047f3028/crates/rspack_watcher/src/paths.rs#L1355-L1365) · [Same-mtime filter](https://github.com/web-infra-dev/rspack/blob/b7c725c5ca805ea5a4e369c2690d39be047f3028/crates/rspack_watcher/src/paths.rs#L1128-L1139)

## Reproduce on Linux x86-64

Run from this directory on a filesystem that supports directory birth time. The compiler uses the same 2.3.4 JavaScript package in both processes. We also checked the results with JavaScript built from the PR CI source tree.

```sh
npm install --prefix . --no-save --package-lock=false --ignore-scripts @rspack/core@2.3.4
gh run download 45740211560 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D main
gh run download 45742405969 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

For the native comparison against the PR's original merge base, reuse the head download.

```sh
gh run download 45339599582 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
node verify-watcher.mjs
```

| Build | Source checked out | Binding SHA-256 |
| --- | --- | --- |
| [Merge base](https://github.com/web-infra-dev/rspack/actions/runs/45339599582/job/138259974230) | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3` | `5b3dfd4aeb9ce00820edcd2e7f157b9c9043e7b286d645c33a647cce3d50bcbc` |
| [Main before the PR test merge](https://github.com/web-infra-dev/rspack/actions/runs/45740211560/job/139643233982) | `d04c7d790867e3c327fcc06b1f2d51585bd24ba1` | `8863ccafd7c92ba95936a594284db85c0347dd61564205dfbfbe45560b4ef073` |
| [PR CI](https://github.com/web-infra-dev/rspack/actions/runs/45742405969/job/139650536988) | `947b81d11668eac3a9668c32404ad98465b74fef` | `5187c2e8ea7a8433774eb1017c517be38368106be73cfcfe7cd2e18ecd9ec30c` |

The test merge's parents are `d04c7d790867e3c327fcc06b1f2d51585bd24ba1` and the reviewed head `b7c725c5ca805ea5a4e369c2690d39be047f3028`, in that order. The native watcher and watcher binding sources match the reviewed head. The paired compiler and native runs used Node.js 22.16.0.
