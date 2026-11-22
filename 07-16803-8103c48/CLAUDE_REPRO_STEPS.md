# Downgrading a nested watch breaks a retained recursive ancestor

1. Register `src` as a directory context, plus `src/sub/index.js` as a file. Missing imports `src/absent/entry.js` and `src/sub/absent/entry.js` make both `src` and `src/sub` recursive. Existing files under `src/sub/deep` belong only to the `src` context.
2. Write a file under `deep`. Both binaries deliver the file's immediate event and the context's aggregate event.
3. Remove only `src/sub/absent/entry.js`. `src` still needs recursive coverage. Wait for a new marker's initial scan to confirm that registration has succeeded. Edit a different file under `deep` and an independent control file.

| After downgrading `sub` | Base | PR |
| --- | --- | --- |
| Kernel watch on `src` and on `sub` | Both present | Both present |
| Kernel watch on `sub/deep` | Present | Absent |
| Immediate file event and aggregated `src` change | Both delivered | Both missed |
| Edit to independent control file | Delivered | Delivered |

The retained `src` context should deliver the second edit. Removing the recursive child deletes the descriptor covering `deep`. Rspack reinstalls explicit descendants and skips the still-recorded recursive ancestor. The test checks kernel descriptors through `/proc/self/fdinfo` and delivers real filesystem writes. [Rspack mode reconciliation](https://github.com/web-infra-dev/rspack/blob/8103c486f1139ce9b53797fb97202a392c5fc882/crates/rspack_watcher/src/disk_watcher.rs#L176-L205), [notify recursive removal](https://github.com/notify-rs/notify/blob/603674a8c7b7dfa396b2cc9925f75606a18bf295/notify/src/inotify.rs#L475-L502)

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
