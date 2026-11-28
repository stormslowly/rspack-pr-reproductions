# Closing a live directory scan runs the JavaScript ignore predicate twice

Move a directory containing 2,048 ordinary files into an existing native watch. On the 32nd file, close the watcher using its public API. The JavaScript ignore predicate accepts every file. The test keeps the process alive after the close promise resolves so it can count calls made to the closed watcher. A control closes it after all moved files have been indexed.

## Run on Linux

Use Linux x86-64 with glibc and Node.js 22. Run these commands in the case directory.

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

Each binding ran each mode three times in a fresh process on the same physical directory. After the final callback the verifier waits for a 300 ms quiet period.

| Close timing | Base | PR |
| --- | --- | --- |
| During the scan | 2,048 calls, zero paths visited twice | 4,096 calls, every path visited twice |
| After the scan completed | 2,048 calls, zero after close | 2,048 calls, zero after close |

When closed during the scan, the base delivered the remaining calls from the original pass. The PR visited all 2,048 paths again after `close()` had already resolved. With this predicate, callbacks continued for 37–38 ms after close on the base and 62–63 ms on the PR. These timings describe a Node process that stays alive.

Closing invalidates the active scan revision. On a revision mismatch the runner starts the next pass before checking whether scans have been closed. That pass filters all directory entries again before discarding the result. [Close invalidation](https://github.com/web-infra-dev/rspack/blob/22ddb87ec9215134b49b32214c84a2f40ae6a3a7/crates/rspack_watcher/src/paths.rs#L221-L231) · [Rescan decision](https://github.com/web-infra-dev/rspack/blob/22ddb87ec9215134b49b32214c84a2f40ae6a3a7/crates/rspack_watcher/src/paths/directory_scan.rs#L132-L137)
