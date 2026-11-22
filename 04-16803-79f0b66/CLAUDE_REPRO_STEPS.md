# A failed recursive upgrade discards a working file watch

Run as an ordinary Linux user. The fixture keeps a writable file inside a directory that still allows traversal by name.

1. Register `src/entry.js` and an independent control file. Wait for the first registration to complete.
2. Set `src` to mode `0111`. Add `src/unresolved/module.js` as a missing dependency. The attempted recursive registration of `src` gets `EACCES`.
3. While the directory still has mode `0111`, edit both files and inspect the inotify descriptors. The verifier restores permissions on its temporary directory before cleanup.

The error can be reported while preserving delivery for the existing subscription. Both binaries report the permission error and deliver the independent control edit.

| After the error | Base 0350265 | Head 79f0b66 |
| --- | --- | --- |
| Kernel watch on `src` | Present | Absent |
| Edit to `src/entry.js` | Delivered | Missed |

The reviewed code explicitly removes the previous mode before attempting the new registration. [Mode transition](https://github.com/web-infra-dev/rspack/blob/79f0b66a064c92fab094a0d0386884c85aabe19c/crates/rspack_watcher/src/disk_watcher.rs#L124-L149)

## Versions and repeat command

Verified with Node.js 22.16.0 on Linux 5.15 x86-64 using glibc and `notify` 8.2.2. Each binary runs in its own Node process.

| CI artifact | Checked-out revision | SHA-256 of `rspack.linux-x64-gnu.node` |
| --- | --- | --- |
| [Base build](https://github.com/web-infra-dev/rspack/actions/runs/44908894098) | `0350265fd086a7caf45f1b00796133e5a753153c` | `d90a1be51843e2deff825da25a284d65968e1e6cf15dd0dfcf5f170010a0505f` |
| [PR build](https://github.com/web-infra-dev/rspack/actions/runs/44974533703/job/137076624986) | `f86f6f57f8536b16c8fab80f07771dc711f578de` | `1153461d5493fe6e48142eea0e76691a792fa122d0939338fd8a26c024b53052` |

The PR build used the test merge of `0350265fd086a7caf45f1b00796133e5a753153c` and `79f0b66a064c92fab094a0d0386884c85aabe19c`, in that parent order. Its Git tree and the reviewed head both resolve to `cc83d37c1dd73acc0f8e22008f510adbc8cdce46`. [Test merge](https://github.com/web-infra-dev/rspack/commit/f86f6f57f8536b16c8fab80f07771dc711f578de), [reviewed head](https://github.com/web-infra-dev/rspack/commit/79f0b66a064c92fab094a0d0386884c85aabe19c)

Run from this case directory. The verifier also accepts absolute paths to the two binding files as its first and second arguments.

```sh
gh run download 44908894098 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 44974533703 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```
