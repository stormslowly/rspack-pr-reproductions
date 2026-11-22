# Editing a subscribed child stops producing native watch events

On Linux a recursive inotify registration owns descriptors for its descendants. Removing that registration can also remove an explicit child watch. [notify 8.2.2](https://github.com/notify-rs/notify/blob/603674a8c7b7dfa396b2cc9925f75606a18bf295/notify/src/inotify.rs#L475-L502)

1. Register a missing `src/unresolved/module.js` so the native watcher watches `src` recursively. Keep a separate control directory subscribed.
2. Replace the missing dependency with an existing `src/sub/entry.js`. In a second fixture, register that file and a direct file from the beginning, then remove only the missing dependency to downgrade `src`.
3. Wait for a newly registered marker's initial scan in each cycle, inspect the kernel descriptor for `src/sub`, and edit both the target and the independent control file.

Both registrations should continue delivering changes to `entry.js`. Both versions successfully register the second watch and deliver the control edit.

| Transition | Base 0350265 | Head 79f0b66 |
| --- | --- | --- |
| Replace the recursive parent with the child | Child descriptor present, edit delivered | Child descriptor absent, edit missed |
| Downgrade the parent while keeping the child | Child descriptor present, edit delivered | Child descriptor absent, edit missed |

On replacement, the reviewed code attaches the child before removing the stale recursive parent. On downgrade, removing the old mode clears the descendant, and the in-memory set still recognizes its pattern. [Pattern installation](https://github.com/web-infra-dev/rspack/blob/79f0b66a064c92fab094a0d0386884c85aabe19c/crates/rspack_watcher/src/disk_watcher.rs#L119-L154), [stale cleanup](https://github.com/web-infra-dev/rspack/blob/79f0b66a064c92fab094a0d0386884c85aabe19c/crates/rspack_watcher/src/disk_watcher.rs#L157-L183)

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
