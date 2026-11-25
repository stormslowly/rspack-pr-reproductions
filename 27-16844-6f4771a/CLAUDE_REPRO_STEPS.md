# A metadata event on a directory symlink hides its subtree from the watch snapshot

Watch `src` with `followSymlinks: true`. An existing directory symlink, `src/workspace/packages/shared`, points to a sibling store containing `route.js`. Registering a regular `entry.js` in the link's parent gives Linux a watch on that directory.

During the first context scan, the JavaScript `ignored` predicate calls `fs.lutimesSync` on the link once and returns `false` for every path. The target and its contents stay the same. The verifier checks that the native event recorded the link's file timestamp before the scan reached its parent. A second watch registration lets it read the snapshot after the first watch has completed.

| Input | Link in `directoryTimestamps` | Linked `route.js` in `fileTimestamps` |
| --- | --- | --- |
| Merge base, concurrent metadata event | Yes | Yes |
| PR, concurrent metadata event | No | No |
| PR, quiet link | Yes | Yes |

With the option enabled, both entries should be present. The live event uses `lstat` and records the symlink as a file. When the scan discovers the directory target, the newer entry blocks its write. The fallback descends only if an earlier observation already recorded the directory bit. This drops all the target's children from the initial snapshot. The verifier checks the snapshot directly and observed the same result in five consecutive comparisons. [Live event handling](https://github.com/web-infra-dev/rspack/blob/6f4771a9d6ae6d9247dc59fd1bdbda623121f7f5/crates/rspack_watcher/src/paths.rs#L952-L991) · [Scan fallback](https://github.com/web-infra-dev/rspack/blob/6f4771a9d6ae6d9247dc59fd1bdbda623121f7f5/crates/rspack_watcher/src/paths.rs#L813-L831)

## Reproduce on Linux

Use Node.js 22 on Linux x86-64 with glibc. Run these commands in the case directory. Each comparison starts a fresh Node process for each binding.

```sh
gh run download 45339599582 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45561008046 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

The measurements used Node.js 22.16.0, Linux 5.15.120 and glibc 2.36. Existing binaries can be passed as `node verify.mjs /path/to/base.node /path/to/head.node`.

| CI binding | Commit checked out | SHA-256 of the binding |
| --- | --- | --- |
| [Merge base](https://github.com/web-infra-dev/rspack/actions/runs/45339599582/job/138259974230) | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3` | `5b3dfd4aeb9ce00820edcd2e7f157b9c9043e7b286d645c33a647cce3d50bcbc` |
| [PR test merge](https://github.com/web-infra-dev/rspack/actions/runs/45561008046/job/139024642883) | `e7a61c6881a9088df14e743574f946f1df5f7ebe` | `e9f328e5a85e8c9ede0a96861e85bd606c9d9c763fc56031a6ae7b6098bc72ea` |
| [Main at the time of PR CI](https://github.com/web-infra-dev/rspack/actions/runs/45554729363/job/139004080299) | `7d34575fb84a3b6491e477380a82cc92dea94488` | `36a8e4a858a4c12e017f382df759bd1baef92ce694960ab1282e4fa676786632` |

The test merge has parents `7d34575fb84a3b6491e477380a82cc92dea94488` and `6f4771a9d6ae6d9247dc59fd1bdbda623121f7f5` (reviewed head), in that order. Its production watcher and native watcher binding sources match the reviewed head. The first parent gives the same control result as the merge base. To repeat that comparison, download run `45554729363` into `main` and run `node verify.mjs main/rspack.linux-x64-gnu.node head/rspack.linux-x64-gnu.node`. [Changes from the first parent](https://github.com/web-infra-dev/rspack/compare/7d34575fb84a3b6491e477380a82cc92dea94488...e7a61c6881a9088df14e743574f946f1df5f7ebe)
