# A later nested scan can lose the retained outer context's pending file change

A watch of `src` starts after a build began and discovers a first write to `src/pages/route.js`. While that file notification is still queued, the file receives a second write. A later watch adds `src/pages` and retains `src`. Its start time is after the second write and the filesystem timestamp accuracy window. The nested scan must record the new timestamp. The outstanding notification for `src` is still due.

The Linux fixture uses regular files and the public native watch API. A real directory move in a separate watched context keeps the event processor busy while the owner applies the two watch registrations. Extra registration markers establish when each scan has finished. The two writes occur before Linux starts watching `src/pages` directly. The test checks both observed timestamps, then writes to an independent watched file and waits for its aggregate to ensure the queue has drained past the pending change.

| Revision and input | Raw `route.js` change callbacks | `src` in aggregated `changedFiles` |
| --- | ---: | --- |
| Merge base, second write | 1 | Yes |
| PR head, second write | 0 | No |
| PR head, same mtime throughout | 1 | Yes |

These results repeated in five comparisons. The CI merge's first parent matched the merge base. The earlier PR revisions `75cd589` and `6f4771a` lost the notification in both variants. The latest commit restores the same-mtime case.

On the PR head, recording a different mtime clears the pending file change. The second scan's later start time makes the new mtime ineligible for another notification. When the original event reaches the queue consumer, the pending pointer no longer matches and the event is discarded. [Clearing the pending change](https://github.com/web-infra-dev/rspack/blob/000ba94522c7bb2f656563d52d8e43af7baa175d/crates/rspack_watcher/src/paths.rs#L344-L355) · [Deciding whether to queue a change](https://github.com/web-infra-dev/rspack/blob/000ba94522c7bb2f656563d52d8e43af7baa175d/crates/rspack_watcher/src/paths.rs#L983-L997) · [Checking the pending pointer](https://github.com/web-infra-dev/rspack/blob/000ba94522c7bb2f656563d52d8e43af7baa175d/crates/rspack_watcher/src/paths.rs#L533-L545)

## Run the comparison

Run in the case directory on Linux x86-64 with glibc and Node.js 22. Each binding runs in a separate Node process. The recorded runs used Node.js 22.16.0, Linux 5.15.120 and glibc 2.36.

```sh
gh run download 45339599582 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45623309153 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

| CI binding | Commit built | SHA-256 of the binding |
| --- | --- | --- |
| [Merge base](https://github.com/web-infra-dev/rspack/actions/runs/45339599582/job/138259974230) | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3` | `5b3dfd4aeb9ce00820edcd2e7f157b9c9043e7b286d645c33a647cce3d50bcbc` |
| [PR test merge](https://github.com/web-infra-dev/rspack/actions/runs/45623309153/job/139237156356) | `74f93c9141a3046de11c305682029a78276d6539` | `14653ed08be273661eec28f9723c36a4f6bfdf09325527dd47438c99b7865dbf` |
| [Main at the time of PR CI](https://github.com/web-infra-dev/rspack/actions/runs/45604847432/job/139173205771) | `f9a8ef34466814e5eae706892701f6c933bd4fe0` | `7b5350c2bd3be28ed6ef4c3d80697559791deb975f2dba86352e790bdcfd0990` |

The test merge's parents, in order, are `f9a8ef34466814e5eae706892701f6c933bd4fe0` and the reviewed head `000ba94522c7bb2f656563d52d8e43af7baa175d`. The production watcher and native watcher binding sources match the reviewed head. For the first-parent comparison, download run `45604847432` into `main` and run `node verify.mjs main/rspack.linux-x64-gnu.node head/rspack.linux-x64-gnu.node`. [Test merge diff against its first parent](https://github.com/web-infra-dev/rspack/compare/f9a8ef34466814e5eae706892701f6c933bd4fe0...74f93c9141a3046de11c305682029a78276d6539)
