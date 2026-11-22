# A full inotify quota prevents replacing an obsolete watch

This case uses `unshare` from util-linux and a private Linux user namespace with writable `/proc/sys/user/max_inotify_watches`. Each child sets that namespace's watch limit to two. The host's limit on the test machine was 899,065 before and after the run. [Kernel user namespace limits](https://www.kernel.org/doc/html/v5.15/admin-guide/sysctl/user.html)

1. Fill both slots with two independent directories, `previous` and `control`.
2. Remove the file dependency under `previous` and add a file under `src` in one watch call. The requested final set still needs exactly two slots.
3. Submit an empty watch delta, then edit the new file and the control file. Inspect the descriptors and the reported errors.

| Outcome | Base 0350265 | Head 79f0b66 |
| --- | --- | --- |
| Replacing the directory | Succeeds | `OS file watch limit reached` |
| Empty retry | New file stays covered | Same error, obsolete descriptor still active |
| Real write in `src` / `control` | Delivered / delivered | Missed / delivered |

The PR tries to install `src` while `previous` still uses the available slot. Returning on the installation error skips the code that could release it. [Error return and stale cleanup](https://github.com/web-infra-dev/rspack/blob/79f0b66a064c92fab094a0d0386884c85aabe19c/crates/rspack_watcher/src/disk_watcher.rs#L153-L170)

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
