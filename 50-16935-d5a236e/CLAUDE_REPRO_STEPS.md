# A missing dependency that appears as a directory still reads as missing

The fixture registers an absent path named `generated` in `missing`, with no explicit directory subscription. A second pre-existing path serves as a marker for the initial scan. The verifier runs `mkdir` and waits for the native watcher's real aggregate callback to report `generated` in `changedFiles` before reading `fileTimestamps`.

## Repeat

Run these commands from this case directory. Each binding runs in a new process with a fresh fixture.

```sh
gh run download 45994103736 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 46162485613 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs base/rspack.linux-x64-gnu.node head/rspack.linux-x64-gnu.node
```

| Observation | Control | PR |
| --- | --- | --- |
| Directory exists on disk after the callback | Yes | Yes |
| Path appeared in `changedFiles` | Yes | Yes |
| Snapshot has a present entry | Yes | No |
| Snapshot lists the path under `missing` | No | Yes |

The expected behavior is that the snapshot reports the directory as present. An existence-only entry would suffice. On the PR, `has_mtime_changed` clears the file record for the directory. With no parent context subscription, no later step creates a directory entry for it.

The control is merge base `15ba844c2da0d8ff0ebbcd0e54fe929b06ab3de2`. The PR head is `d5a236e19b630d5ebe69071b7f02c308617df803`. The candidate binding was compiled from GitHub's test merge `a6e5daa07832d310d767b2664b79f28b1990ef95`, with parents `2ad0fabd41d9938ad3446dac95c8cf9d3ddd7bb9` and `d5a236e19b630d5ebe69071b7f02c308617df803`. The watcher sources in this merge match the PR head. The test ran on Linux x86-64 with glibc and Node.js 22.22.3.

## Metadata calls on the same event path

On Linux, `strace` can also count metadata calls for a registered regular file whose timestamp is unchanged. The script sends 256 duplicate change events through the native binding, followed by a separate sentinel event to wait for processing. Each run also starts and closes the watcher. Run from the same directory after downloading the bindings.

```sh
trace_dir=$(mktemp -d)
for side in base head; do
  for count in 0 256; do
    fixture="$trace_dir/$side-$count"
    strace -f -qq -e trace=%file -o "$fixture.trace" \
      node measure-stale-events.cjs "$side/rspack.linux-x64-gnu.node" "$count" "$fixture"
    grep -F "$fixture/measured.js" "$fixture.trace" | grep -Ec '(statx|newfstatat|lstat|stat)\('
  done
done
```

| Injected change events | Control | PR |
| --- | --- | --- |
| 0 | 6 | 6 |
| 256 | 517 | 773 |

This run observed one extra metadata query per event. The new type check calls `symlink_metadata` before the existing mtime read. The counts cover the target file, including registration. They do not measure rebuild latency.
