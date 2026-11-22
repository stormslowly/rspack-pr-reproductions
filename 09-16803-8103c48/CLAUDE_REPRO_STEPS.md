# Bulk inotify downgrades take quadratic time

Each independent directory contains one registered `entry.js` and has no child directories. A registered missing path `generated/entry.js` makes each directory require recursive coverage. Withdraw all the missing paths in a single watch request while keeping every direct file subscribed. The final set needs exactly the same number of inotify descriptors.

After setup, the binding owner thread signals readiness through an ignored marker. The script times one entire removal request up to the next marker, then re-adds all missing paths before sampling again. Five samples are collected per size and binary. `/proc/self/fdinfo` confirms that the number of directory watches equals the fixture size before and after each downgrade.

| Directories downgraded | Base median, ms (runs 1 / 2) | PR median, ms (runs 1 / 2) |
| ---: | ---: | ---: |
| 1,000 | 2.63 / 2.47 | 90.72 / 82.34 |
| 2,000 | 4.98 / 5.30 | 266.38 / 271.54 |
| 4,000 | 9.43 / 13.44 | 973.32 / 968.41 |

The base retains an existing entry for the shallow mode when both modes were originally requested. The reviewed PR applies the downgrade by calling `unwatch` for every recursive directory. Each such call in `notify` scans its complete remaining descriptor map for descendants, including for these disjoint directories. Doubling the batch from 2,000 to 4,000 increased elapsed time 3.65× on the PR. [Rspack unwatch loop](https://github.com/web-infra-dev/rspack/blob/8103c486f1139ce9b53797fb97202a392c5fc882/crates/rspack_watcher/src/disk_watcher.rs#L142-L172), [notify 8.2.2 implementation](https://github.com/notify-rs/notify/blob/603674a8c7b7dfa396b2cc9925f75606a18bf295/notify/src/inotify.rs#L475-L502)

An application can reach this transition when a rebuild drops many unresolved imports while retaining their direct file dependencies. The measured operation is one native watch update, with fixture setup and teardown outside the timed interval.

## Binaries and rerun instructions

Linux x86-64 with glibc, kernel 5.15 and Node.js 22.16.0. The PR uses `notify` 8.2.2. Each binding executes in a separate Node process.

| Artifact | Revision built by CI | SHA-256 of the native binding |
| --- | --- | --- |
| [Base run](https://github.com/web-infra-dev/rspack/actions/runs/44908894098) | `0350265fd086a7caf45f1b00796133e5a753153c` | `d90a1be51843e2deff825da25a284d65968e1e6cf15dd0dfcf5f170010a0505f` |
| [PR build](https://github.com/web-infra-dev/rspack/actions/runs/45013328192/job/137180319549) | `da96e75601f2a53f9924db450c0cd308273a9544` | `69e68ca4d4b283747a354d85122665741c5dd94169394947030195b343a01124` |

The test merge has parents `0350265fd086a7caf45f1b00796133e5a753153c` and `8103c486f1139ce9b53797fb97202a392c5fc882`, in that order. The merge and reviewed head have the same tree, `f486ff208a24131c228a5a2d25651bae322a430f`. [Test merge](https://github.com/web-infra-dev/rspack/commit/da96e75601f2a53f9924db450c0cd308273a9544), [reviewed head](https://github.com/web-infra-dev/rspack/commit/8103c486f1139ce9b53797fb97202a392c5fc882)

From this case directory, download the artifacts and run the live comparison. The scripts also accept paths to the base and PR binding as their two arguments.

```sh
gh run download 44908894098 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45013328192 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```
