# A failed watch update silences an independent file subscription

A running native watcher has subscribed to a writable source file and delivered its first batch. Without pausing it, the caller adds a different directory to the watch. The directory permits traversal but its permissions reject a new inotify watch. Both versions deliver the registration error to the caller. The verifier then edits the existing source and waits until its new timestamp appears through `collectTimeInfoEntries()`.

On base the existing subscription also delivers its change callback. On the PR the edit remains visible in `peekAggregated()` with no aggregate callback. The probe leaves the watcher running for 400 ms after observing the timestamp, with `aggregateTimeout` set to 20 ms. The failure path returns after `begin_watch` has paused delivery. Only a successful watch request sends the transition that resumes it. [Watch transition and error return](https://github.com/web-infra-dev/rspack/blob/31d03a0809c8a865564c69c6b0038ad7228c5346/crates/rspack_watcher/src/lib.rs#L388-L401)

| Three consecutive runs | New directory registration | Original file timestamp | Original file aggregate callback | Edit still pending |
| --- | --- | --- | --- | --- |
| Base | Permission denied | Updated | Delivered | No |
| PR | Permission denied | Updated | Absent | Yes |

This case covers callers that update an active watcher without first calling `pause()`. Its only permission change is inside a newly created temporary directory. Each binary runs in a separate Node process.

## Run

From this case directory, run the following commands on Linux x86-64 with glibc as a regular user.

```sh
gh run download 45878746840 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45878746052 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs base/rspack.linux-x64-gnu.node head/rspack.linux-x64-gnu.node
```

## Versions

The comparison ran on Linux x86-64 with glibc 2.36 and Node.js 22.16.0. Both CI jobs built a test merge whose Git tree equals the corresponding reviewed revision.

| Revision | CI checkout and parents | SHA-256 of the Linux GNU binding |
| --- | --- | --- |
| [Base `aac0d26`](https://github.com/web-infra-dev/rspack/commit/aac0d26a0b16dcfd8b89085eeebe0ecf620271a0) | [CI build](https://github.com/web-infra-dev/rspack/actions/runs/45878746840/job/140123962062) at `09c73233c560a49da858b3412f814f1eb181685a`, parents `3d7defb03ab020537a6d0a2da71d5bb7255dc492` and `aac0d26a0b16dcfd8b89085eeebe0ecf620271a0` | `43d5aa5802ed8ac28810a91e74d7a8fe00bcf11358a47e74f1eaff308f29ff58` |
| [PR `31d03a0`](https://github.com/web-infra-dev/rspack/commit/31d03a0809c8a865564c69c6b0038ad7228c5346) | [CI build](https://github.com/web-infra-dev/rspack/actions/runs/45878746052/job/140121847789) at `f80288636f1e8b138c1472cfbd5ae37265d1f127`, parents `aac0d26a0b16dcfd8b89085eeebe0ecf620271a0` and `31d03a0809c8a865564c69c6b0038ad7228c5346` | `ff80d89120a9e316c67c1b7aef864dc605b5563c702ba0b8f8ba75c532d881a7` |
