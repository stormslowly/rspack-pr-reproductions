# A live subtree scan bypasses the watcher's blocking worker limit

The native watcher limits blocking workers to 16 on the runtime that installs a watch. It also scans a newly moved-in directory on its filesystem event runtime. This second runtime receives the default Tokio thread-pool limit. The same tree therefore has different thread usage depending on when it enters the watch.

## Run on Linux

Use Linux x86-64 with glibc, Node.js 22, `/proc`, and util-linux `taskset`. The verifier runs each child process with affinity to one allowed CPU, matching a single-core build environment. It changes only that child's affinity.

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

The fixture has 32 directories containing one ordinary file each. In the initial-registration control, the watcher starts on the populated tree. In the live case it starts on a directory containing a seed file. After the seed has a timestamp, one filesystem rename moves the populated tree into that directory. The verifier reads Linux thread names before the operation and when all 32 file timestamps become available. It counts new `tokio-rt-worker` threads. Both sides finish indexing every file.

| Scenario | Base, three trials | PR, three trials |
| --- | --- | --- |
| Tree present when registered | 0 / 0 / 0 | 16 / 16 / 16 |
| Tree moved in after registration | 0 / 0 / 0 | 97 / 97 / 97 |

The watcher queues child-directory futures together. A directory received from a live filesystem event runs those futures on the event filter runtime. The 16-worker setting applies to the owner runtime alone. Tokio 1.54.1 defaults to a limit of 512 blocking workers per runtime. The measured number of threads depends on scheduling and CPU availability. These counts were taken at scan completion. [Directory scheduling](https://github.com/web-infra-dev/rspack/blob/bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60/crates/rspack_watcher/src/paths/scan.rs#L31-L39) · [Owner pool limit](https://github.com/web-infra-dev/rspack/blob/bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60/crates/rspack_watcher/src/lib.rs#L383-L392) · [Live event runtime](https://github.com/web-infra-dev/rspack/blob/bfdfaf1d626e86f9ecbbd0440bab3ac670fafc60/crates/rspack_watcher/src/trigger.rs#L155-L166) · [Tokio pool defaults](https://github.com/tokio-rs/tokio/blob/b53b2001ed2ccfd9b87e32a0c6da1a1eebdc80b8/tokio/src/runtime/builder.rs#L324-L327)
