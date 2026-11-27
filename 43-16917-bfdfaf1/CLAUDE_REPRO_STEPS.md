# A large flat context takes longer to report a startup change

Register a native watcher for one directory containing ordinary files. Only `changed.js` has an mtime inside the 15-second build-to-watch gap. The directory and all other files have old mtimes. No writes occur during the watch. The timer starts at `NativeWatcher.watch()` and stops at the first undelayed callback. Afterwards, the verifier checks that every file has a timestamp.

## Run on Linux

Use Linux x86-64 with glibc and Node.js 22. Run the following commands in this case directory.

```sh
gh run download 45964163488 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45974918126 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

## Versions

| Component | Revision |
| --- | --- |
| [Base Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/45964163488/artifacts/15181493502) | The actual merge base `4dff634eef4acfeac44156d2a44eef80af0985f7` |
| [PR Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/45974918126/artifacts/15187417068) | Test merge `1f8a6b9ec6a9be5301fe3ed48942277b0297535b` |
| [Reviewed head](https://github.com/web-infra-dev/rspack/pull/16917) | `bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60` |

The test merge combines first parent `9e9e63d5c7eafcb4374b2875a633e567fb263c3c` with the reviewed head as second parent. The five differences between that merge and the head affect JavaScript stats or its tests. All Rust source is identical. [Compare the head and test merge](https://github.com/web-infra-dev/rspack/compare/bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60...1f8a6b9ec6a9be5301fe3ed48942277b0297535b)

## Observed with Node.js 22.16.0

Both sides use the same physical files and default watcher options. Each measurement starts a fresh process. The verifier runs one unmeasured pair before five measured pairs, alternating execution order. There is no JavaScript ignore predicate, profiler or compiler in the timed interval.

| Unchanged siblings plus one changed file | Base trials (ms) | PR trials (ms) | Median, base / PR |
| --- | --- | --- | --- |
| 256 + 1 | 1.7, 1.9, 2.3, 1.7, 1.7 | 4.6, 4.6, 4.6, 4.6, 4.7 | 1.7 / 4.6 ms |
| 8,192 + 1 | 26.8, 25.4, 25.9, 24.8, 26.2 | 126.5, 134.7, 127.2, 125.3, 140.2 | 25.9 / 127.2 ms |

A context's startup notifications are delivered when enumeration ends. The baseline reads each entry's metadata directly in its directory walk. The PR sends each entry's metadata read to a blocking worker and awaits its return before submitting the next one from that directory. For 8,192 unchanged siblings, the first notification arrived about 101 ms later. The measurement covers a newly registered flat context on Linux. [Baseline loop](https://github.com/web-infra-dev/rspack/blob/4dff634eef4acfeac44156d2a44eef80af0985f7/crates/rspack_watcher/src/paths/scan.rs#L58-L66) · [PR loop](https://github.com/web-infra-dev/rspack/blob/bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60/crates/rspack_watcher/src/paths/directory_scan.rs#L183-L197)
