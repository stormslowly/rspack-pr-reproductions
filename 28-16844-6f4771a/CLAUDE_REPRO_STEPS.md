# A retired directory scan delays changes to files that are still watched

Move a directory containing 8,192 regular files into a watched context. A second, independent directory contains a file that stays subscribed. On the first child of the moved directory, the JavaScript `ignored` predicate submits a watch update that retires the context. It waits for a trailing registration to disappear, writes to the independently watched file, and then returns `false`. All subsequent predicate calls return immediately.

| Five live comparisons | Merge base | PR |
| --- | ---: | ---: |
| Further calls to `ignored` for retired siblings | 0 each run | 8,191 each run |
| Time from writing the retained file to its undelayed callback, median | 5 ms | 140 ms |
| Range | 5–5 ms | 135–152 ms |

With the only covering context gone, the directory walk can stop and the event processor can deliver the retained file's change. The previous orphan check broke out of the current directory. In the PR, the rejected observation continues to the next sibling, whose JavaScript predicate and metadata read run before its own subscription check. A single event-processing thread waits for that walk. The verifier asserts the callback counts. The elapsed times describe the machine and workload used here. [Previous orphan check](https://github.com/web-infra-dev/rspack/blob/84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3/crates/rspack_watcher/src/paths.rs#L705-L718) · [Current scan loop](https://github.com/web-infra-dev/rspack/blob/6f4771a9d6ae6d9247dc59fd1bdbda623121f7f5/crates/rspack_watcher/src/paths.rs#L805-L832) · [Event processor](https://github.com/web-infra-dev/rspack/blob/6f4771a9d6ae6d9247dc59fd1bdbda623121f7f5/crates/rspack_watcher/src/trigger.rs#L150-L167)

## Reproduce on Linux

Use Node.js 22 on Linux x86-64 with glibc. Run these commands in the case directory. Each comparison starts a fresh Node process for each binding.

```sh
gh run download 45339599582 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45561008046 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

The measurements used Node.js 22.16.0, Linux 5.15.120 and glibc 2.36. Existing binaries can be passed as `node verify.mjs /path/to/base.node /path/to/head.node`.

| CI binding | Commit checked out | SHA-256 of the binding |
| --- | --- | --- |
| [Merge base](https://github.com/web-infra-dev/rspack/actions/runs/45339599582/job/138259974230) | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3` | `5b3dfd4aeb9ce00820edcd2e7f157b9c9043e7b286d645c33a647cce3d50bcbc` |
| [PR test merge](https://github.com/web-infra-dev/rspack/actions/runs/45561008046/job/139024642883) | `e7a61c6881a9088df14e743574f946f1df5f7ebe` | `e9f328e5a85e8c9ede0a96861e85bd606c9d9c763fc56031a6ae7b6098bc72ea` |
| [Main at the time of PR CI](https://github.com/web-infra-dev/rspack/actions/runs/45554729363/job/139004080299) | `7d34575fb84a3b6491e477380a82cc92dea94488` | `36a8e4a858a4c12e017f382df759bd1baef92ce694960ab1282e4fa676786632` |

The test merge has parents `7d34575fb84a3b6491e477380a82cc92dea94488` and `6f4771a9d6ae6d9247dc59fd1bdbda623121f7f5` (reviewed head), in that order. Its production watcher and native watcher binding sources match the reviewed head. The first parent gives the same control result as the merge base. To repeat that comparison, download run `45554729363` into `main` and run `node verify.mjs main/rspack.linux-x64-gnu.node head/rspack.linux-x64-gnu.node`. [Changes from the first parent](https://github.com/web-infra-dev/rspack/compare/7d34575fb84a3b6491e477380a82cc92dea94488...e7a61c6881a9088df14e743574f946f1df5f7ebe)

## Recheck on `000ba94`

All five reruns produced 0 further predicate calls on the merge base and 8,191 on the revised PR. The independent file's median callback delay was 5 ms on the base and 145 ms on the PR (137–158 ms). The PR CI test merge was `74f93c9141a3046de11c305682029a78276d6539`. Its parents were `f9a8ef34466814e5eae706892701f6c933bd4fe0` and the reviewed head `000ba94522c7bb2f656563d52d8e43af7baa175d`. Repeating against the first parent also produced 0 versus 8,191. [PR binding](https://github.com/web-infra-dev/rspack/actions/runs/45623309153/job/139237156356) · [Current scan loop](https://github.com/web-infra-dev/rspack/blob/000ba94522c7bb2f656563d52d8e43af7baa175d/crates/rspack_watcher/src/paths.rs#L873-L900)

```sh
gh run download 45623309153 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head-000ba94
node verify.mjs base/rspack.linux-x64-gnu.node head-000ba94/rspack.linux-x64-gnu.node
```

## Recheck on `f5cd1d2`

Five comparisons again counted 0 further predicate calls on the merge base and 8,191 on the PR. The median delay for the independently watched file was 5 ms (range 5–6 ms) on the merge base and 142 ms (range 138–145 ms) on the PR. The first PR commit `75cd589` already produced 8,191 extra calls. The main commit used by the current PR build produced 0. [First PR build](https://github.com/web-infra-dev/rspack/actions/runs/45340563950/job/138263110271) · [Current scan loop](https://github.com/web-infra-dev/rspack/blob/f5cd1d2ff1ae0d6ba8b8093f3a08d10bb59b9826/crates/rspack_watcher/src/paths.rs#L798-L819)

The reviewed head was `f5cd1d2ff1ae0d6ba8b8093f3a08d10bb59b9826`. CI built `0114306f1e8419d80cd61301f6e4910d23eef10b` with first parent `f9a8ef34466814e5eae706892701f6c933bd4fe0` and the reviewed head as its second parent. The Linux binding SHA-256 was `10a08c61da50462a85a78df20e98bf3cdeea6e957cf423450824c761f9143393`. [PR binding](https://github.com/web-infra-dev/rspack/actions/runs/45666007535/job/139388537232)

```sh
gh run download 45666007535 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head-f5cd1d2
node verify.mjs base/rspack.linux-x64-gnu.node head-f5cd1d2/rspack.linux-x64-gnu.node
```
