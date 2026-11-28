# Retiring a missing dependency during a directory scan drops its timestamp

A loader watches an assets directory and initially registers a missing generated manifest. An entry edit makes the loader drop the explicit missing dependency while keeping the directory dependency. During that rebuild, a real filesystem rename moves a directory containing the manifest, a sibling and 64 other files into the watched directory. The next `watchRun` reads `compiler.fileTimestamps` and a plugin emits the observed manifest state.

## Run on Linux

Use Linux x86-64 with glibc and Node.js 22. Run these commands in the case directory.

```sh
gh run download 45994103736 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 46088741380 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
npm pack @rspack-canary/core@2.3.5-canary-56ed00d7-20261126172159 --ignore-scripts --registry=https://registry.npmjs.org
tar -xzf rspack-canary-core-2.3.5-canary-56ed00d7-20261126172159.tgz
node verify.mjs
```

## Versions

| Component | Revision |
| --- | --- |
| [Base Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/45994103736/artifacts/15194369637) | Merge base `15ba844c2da0d8ff0ebbcd0e54fe929b06ab3de2` |
| [PR Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/46088741380/artifacts/15239992823) | Test merge `b05f77c4ccf0714009e75f9f3b80e8e8bba7a93e` |
| [Reviewed head](https://github.com/web-infra-dev/rspack/pull/16920) | `22ddb87ec9215134b49b32214c84a2f40ae6a3a7` |

The test merge's first parent is the merge base and its second parent is the reviewed head. Its Git tree is identical to the reviewed head. The downloaded binary SHA-256 digests are `f852744f1d0b6b4123a1059eafdd4d87b17bb851d2556f848d7622683a54239d` (base) and `9ad5269cb045f60c775a8e2ae8d67873526e639b7f3f37995d7cd5b4a615e719` (PR). [CI checkout](https://github.com/web-infra-dev/rspack/actions/runs/46088741380/job/140804537384)

Both bindings use the same JavaScript compiler, built from `56ed00d769842dffb13b4c03477da8f3cacf3fba`. Its `Watching.ts`, `NativeWatchFileSystem.ts` and `watchTimeInfo.ts` match the reviewed head and merge base. [Compiler timestamp handling](https://github.com/web-infra-dev/rspack/blob/22ddb87ec9215134b49b32214c84a2f40ae6a3a7/packages/rspack/src/Watching.ts#L315-L340)

## Observed with Node.js 22.16.0

The manifest is on disk with the same mtime for every observation after the move. A JavaScript ignore predicate accepts every path and spends 1 ms on each moved child to keep the scan open while the compiler sends its real registration update. The verifier checks that the update landed between the first and last child. It runs each mode three times per binding in fresh compiler processes.

| Subscription change | Base asset after the move | PR asset after the move | Asset after a further independent entry edit |
| --- | --- | --- | --- |
| Retire the missing dependency during the scan | `present` in all three runs | `missing` in all three runs | Base `present`, PR `missing` |
| Keep the missing dependency through the scan | `present` in all three runs | `present` in all three runs | `present` on both versions |

The enclosing context triggered the rebuild, and the sibling's timestamp was present in every run. On the PR, the manifest key itself was absent. Unregistering a missing dependency calls `FileTimes::clear`, which records the path as a live observation even when there is no file record to clear. The directory commit then skips the file it read from disk. [Dependency cleanup](https://github.com/web-infra-dev/rspack/blob/22ddb87ec9215134b49b32214c84a2f40ae6a3a7/crates/rspack_watcher/src/paths.rs#L490-L502) · [Recording a live observation](https://github.com/web-infra-dev/rspack/blob/22ddb87ec9215134b49b32214c84a2f40ae6a3a7/crates/rspack_watcher/src/paths/time_info.rs#L156-L162) · [Commit skipping the entry](https://github.com/web-infra-dev/rspack/blob/22ddb87ec9215134b49b32214c84a2f40ae6a3a7/crates/rspack_watcher/src/paths/scan_commit.rs#L71-L85)
