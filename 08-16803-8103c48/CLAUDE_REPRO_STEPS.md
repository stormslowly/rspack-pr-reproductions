# A mode downgrade interrupts existing file subscriptions

**Failed downgrade.** Run `node verify.mjs` as an unprivileged Linux user. Register an existing `src/entry.js` and a deep missing import so `src` is watched recursively. Change the directory permissions to `0111`, then withdraw only the missing dependency. The existing file remains writable by name.

| After the downgrade attempt | Base | PR |
| --- | --- | --- |
| Registration error | None | `EACCES` |
| Kernel watch on `src` | Present | Absent |
| Write to the still-subscribed `entry.js` | Immediate and aggregate events delivered | Both missed |
| Edit in an independent directory | Delivered | Delivered |

**Successful downgrade with concurrent writes.** After downloading the same binaries, run `node concurrent-edits.mjs`. This independent fixture uses ordinary readable directories. It registers 100 direct files and a deep missing dependency, then withdraws the missing dependency while writing all 100 distinct files. Each file had an old initial timestamp. An ignored marker starts the writer at the beginning of the update. The tree has 8,000 empty subdirectories to make the transition observable.

| Observed in four paired runs | Base | PR |
| --- | ---: | ---: |
| Edits delivered out of 100 | 100, 100, 100, 100 | 78, 78, 78, 78 |
| Separate edit after registration completed | Delivered in all runs | Delivered in all runs |
| Registration errors | 0 | 0 |

The number of missed concurrent writes depends on scheduling. Both scenarios exercise the same interval between removal of the old recursive watch and attachment of the new shallow one. The pending scanner only checks newly added paths, so it has no work for an already-subscribed file edited during that interval. [Mode downgrade](https://github.com/web-infra-dev/rspack/blob/8103c486f1139ce9b53797fb97202a392c5fc882/crates/rspack_watcher/src/disk_watcher.rs#L140-L161), [installation](https://github.com/web-infra-dev/rspack/blob/8103c486f1139ce9b53797fb97202a392c5fc882/crates/rspack_watcher/src/disk_watcher.rs#L191-L216), [pending scanner](https://github.com/web-infra-dev/rspack/blob/8103c486f1139ce9b53797fb97202a392c5fc882/crates/rspack_watcher/src/scanner.rs#L35-L45)

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
