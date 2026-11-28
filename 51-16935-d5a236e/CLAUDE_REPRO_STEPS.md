# Removing an empty nested context adds a deleted alias to changedFiles

Register both a parent directory and an empty child as directory dependencies. The child has no file or missing dependency and no contents. Remove it with `rmdir` after the initial scan completes. The existing [nested-context regression test](https://github.com/web-infra-dev/rspack/blob/d5a236e19b630d5ebe69071b7f02c308617df803/tests/rspack-test/compilerCases/native-watcher-nested-context-removal.mjs#L149-L156) expects this operation to mark only the parent changed.

## Repeat

Run the following commands from the case directory on x86-64 Linux with glibc and Node.js. The verifier compares both child spellings on both real bindings in separate processes.

```sh
gh run download 45994103736 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 46162485613 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs base/rspack.linux-x64-gnu.node head/rspack.linux-x64-gnu.node
```

| Child spelling | Control `changedFiles` | PR `changedFiles` |
| --- | --- | --- |
| `outer/inner` | `outer` | `outer` |
| `outer/inner/` | `outer` | `outer`, `outer/inner/` |

On the same Linux host, [Watchpack 2.6.4](https://github.com/webpack/watchpack/tree/c68fe7cad300ce9c1b499afde6714f02fbe1fff1) reported only `outer` as changed for both spellings. Its removal set was empty in both runs.

All four `removedFiles` sets were empty. The aggregate on the candidate now includes a deleted directory as changed solely because of its registration spelling. The event processor expands a physical path into logical names before classifying a nested removal. An equality check subsequently compares the logical name ending in `/` with the OS path.

The control is `15ba844c2da0d8ff0ebbcd0e54fe929b06ab3de2` and the reviewed head is `d5a236e19b630d5ebe69071b7f02c308617df803`. The candidate binding was compiled from merge `a6e5daa07832d310d767b2664b79f28b1990ef95`, with parents `2ad0fabd41d9938ad3446dac95c8cf9d3ddd7bb9` and `d5a236e19b630d5ebe69071b7f02c308617df803`. The Linux run used Node.js 22.22.3.
