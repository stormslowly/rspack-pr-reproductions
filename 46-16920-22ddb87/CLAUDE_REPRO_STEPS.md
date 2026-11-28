# Directory commits can make one synchronous timestamp query scan the entire registry repeatedly

A running native watcher has 8,192 registered missing paths, an explicit dependency that was just deleted, and a watched directory. A single rename moves 1,536 subdirectories of 12 files each into the watch. While they are being indexed, the test calls the same synchronous timestamp API that the compiler uses before a rebuild.

## Run on Linux

Use Linux x86-64 with glibc, Node.js 22 and `strace`. Run these commands in the case directory.

```sh
gh run download 45994103736 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 46088741380 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

## Versions

| Component | Revision |
| --- | --- |
| [Base Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/45994103736/artifacts/15194369637) | Merge base `15ba844c2da0d8ff0ebbcd0e54fe929b06ab3de2` |
| [PR Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/46088741380/artifacts/15239992823) | Test merge `b05f77c4ccf0714009e75f9f3b80e8e8bba7a93e` |
| [Reviewed head](https://github.com/web-infra-dev/rspack/pull/16920) | `22ddb87ec9215134b49b32214c84a2f40ae6a3a7` |

The test merge's first parent is the merge base and its second parent is the reviewed head. Its Git tree is identical to the reviewed head. The downloaded binary SHA-256 digests are `f852744f1d0b6b4123a1059eafdd4d87b17bb851d2556f848d7622683a54239d` (base) and `9ad5269cb045f60c775a8e2ae8d67873526e639b7f3f37995d7cd5b4a615e719` (PR). [CI checkout](https://github.com/web-infra-dev/rspack/actions/runs/46088741380/job/140804537384)

## Observed with Node.js 22.16.0

Each timed trial uses a fresh process and the same physical paths. The test times only the native `collectTimeInfoEntries()` call. Fixture creation, timers, decoding the returned rows and tracing are outside that interval. It checks that all 18,432 moved files eventually have timestamps. Each trial samples during the move and also takes five samples before and after it.

| Longest synchronous call during each move | Trial 1 | Trial 2 | Trial 3 | Median |
| --- | --- | --- | --- | --- |
| Base | 7.8 ms | 7.8 ms | 10.1 ms | 7.8 ms |
| PR | 34.3 ms | 40.2 ms | 33.8 ms | 34.3 ms |

Once the scan settled, both bindings took about 8 ms per call. To distinguish retries from normal collection cost, a separate run traces the main JavaScript thread. The deleted explicit dependency has no cached timestamp and gets one fallback stat per complete collection pass. The test counts only stats between the markers surrounding a single native call. It saw one stat per call on the base and five in one call on the PR.

The query captures a global revision and discards the complete result whenever a directory commit advances it. A stream of small commits can therefore cause repeated work while the JavaScript thread is waiting for a single snapshot. [Retry loop](https://github.com/web-infra-dev/rspack/blob/22ddb87ec9215134b49b32214c84a2f40ae6a3a7/crates/rspack_watcher/src/paths/time_info.rs#L333-L341) · [Directory commit](https://github.com/web-infra-dev/rspack/blob/22ddb87ec9215134b49b32214c84a2f40ae6a3a7/crates/rspack_watcher/src/paths/directory_scan.rs#L143-L150)
