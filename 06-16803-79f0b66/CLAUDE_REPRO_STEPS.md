# Rewatch cost grows quadratically with the number of directories

The verifier registers existing directories using the production Linux `NativeWatcher` and checks the inotify descriptor count. It then issues watch requests with unchanged dependencies. An ignored marker signals when the watcher owner thread starts the next request, so timing includes the native watch updates. Fixture creation, initial watch installation and teardown are outside the timed interval.

Each number is the median of five batches, divided by the number of watch updates in the batch. Each directory batch has eight updates. One update crosses the ignored-marker callback. The remaining updates have completely empty deltas. The same callback and workload run on both binaries.

| Real directory watches | Base 0350265, ms/update | Head 79f0b66, ms/update |
| ---: | ---: | ---: |
| 2,000 | 0.2542 | 1.6164 |
| 4,000 | 0.3783 | 5.9108 |
| 8,000 | 0.6593 | 23.0511 |

The base indexes desired paths in hash sets. The PR scans all previously seen paths while building the desired vector and searches it again for each active pattern during cleanup. The 4,000 to 8,000 step increases the PR time by 3.90×. These are native re-registration timings, measured with the Linux directory analyzer. [Desired path collection](https://github.com/web-infra-dev/rspack/blob/79f0b66a064c92fab094a0d0386884c85aabe19c/crates/rspack_watcher/src/disk_watcher.rs#L103-L115), [stale-path lookup](https://github.com/web-infra-dev/rspack/blob/79f0b66a064c92fab094a0d0386884c85aabe19c/crates/rspack_watcher/src/disk_watcher.rs#L157-L163)

## Separate measurement for unchanged missing dependencies

This fixture holds the number of kernel watches at one. Each batch has forty updates. The expected scan work on an empty delta is independent of the number of previously registered missing paths. In the PR, `read_pending_scans` clones the complete missing set before the scanner checks whether there is any pending work. [Pending snapshot](https://github.com/web-infra-dev/rspack/blob/79f0b66a064c92fab094a0d0386884c85aabe19c/crates/rspack_watcher/src/paths.rs#L376-L391), [scanner guard](https://github.com/web-infra-dev/rspack/blob/79f0b66a064c92fab094a0d0386884c85aabe19c/crates/rspack_watcher/src/scanner.rs#L35-L42)

| Missing paths | Base, ms/update | Head, ms/update |
| ---: | ---: | ---: |
| 10,000 | 0.1433 | 0.4146 |
| 50,000 | 0.1439 | 1.6902 |

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
