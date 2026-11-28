# A POSIX filename ending in a backslash is exported under another name

The fixture puts one file named `theme\` in a watched asset directory. On Linux the last byte is a literal backslash. There is no file named `theme`. A separate, existing missing dependency serves as a readiness marker because its backfill happens after the native watcher's initial context scan.

## Repeat

Run these commands from this case directory. The verifier creates both fixtures itself, runs the real bindings in separate processes, and reads `collectTimeInfoEntries().fileTimestamps`.

```sh
gh run download 45994103736 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 46162485613 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs base/rspack.linux-x64-gnu.node head/rspack.linux-x64-gnu.node
```

| Snapshot entry | Expected and observed on the control | Observed on the PR |
| --- | --- | --- |
| Real file `theme\` | Present | Absent |
| Nonexistent file `theme` | Absent | Present |

The Unix branch of `normalize_dir_path` strips the last backslash. The context scan calls that function on the **file** path before inserting the timestamp. A consumer of the snapshot therefore gets a timestamp under a path that does not exist.

The control is merge base `15ba844c2da0d8ff0ebbcd0e54fe929b06ab3de2`. The PR head is `d5a236e19b630d5ebe69071b7f02c308617df803`. The candidate binding was compiled from GitHub's test merge `a6e5daa07832d310d767b2664b79f28b1990ef95`, with parents `2ad0fabd41d9938ad3446dac95c8cf9d3ddd7bb9` and `d5a236e19b630d5ebe69071b7f02c308617df803`. The watcher sources in this merge match the PR head. The test ran on Linux x86-64 with glibc and Node.js 22.22.3.
