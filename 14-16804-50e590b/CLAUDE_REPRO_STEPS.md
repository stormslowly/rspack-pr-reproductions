# A native event can reach a registration after it has been revoked

Watch `old.js`, then edit it on disk. The production watcher calls the JavaScript `ignored` predicate for the incoming event. During that callback the test enqueues a new watch cycle that drops `old.js`. It waits until the native timestamp table confirms removal before returning `false`. This orders a watch update against an in-flight asynchronous filter without relying on a sleep to win the race. An independent file write confirms the new cycle can still deliver events.

| After revocation | Base | PR |
| --- | --- | --- |
| Immediate event for `old.js` | none | `old.js` |
| Aggregated changed dependency | none | `old.js` |

The graph is consulted before awaiting the JavaScript predicate. A target captured by that lookup can be delivered after its registration was removed. The baseline check returns true for an unregistered path, which lets the old event invalidate the new cycle. [Lookup before the predicate](https://github.com/web-infra-dev/rspack/blob/50e590b31efa4877a3fb7714b66869d89b7362d3/crates/rspack_watcher/src/trigger.rs#L153-L155) · [Baseline check](https://github.com/web-infra-dev/rspack/blob/50e590b31efa4877a3fb7714b66869d89b7362d3/crates/rspack_watcher/src/paths.rs#L1230-L1237)

## Live comparison

The runs use Linux x86-64, glibc 2.36, kernel 5.15 and Node.js 22.16.0. The verifier loads each CI binding in its own Node process.

| Build | Commit built by CI | Parents in order | Binding SHA-256 |
| --- | --- | --- | --- |
| [Base job](https://github.com/web-infra-dev/rspack/actions/runs/45013328192/job/137180319549) | `da96e75601f2a53f9924db450c0cd308273a9544` | `0350265fd086a7caf45f1b00796133e5a753153c`, `8103c486f1139ce9b53797fb97202a392c5fc882` | `69e68ca4d4b283747a354d85122665741c5dd94169394947030195b343a01124` |
| [PR job](https://github.com/web-infra-dev/rspack/actions/runs/45013338903/job/137180354887) | `8ca1aeb388d56439f37855be15c3408aa7bd7db9` | `8103c486f1139ce9b53797fb97202a392c5fc882`, `50e590b31efa4877a3fb7714b66869d89b7362d3` | `95cdc2d026df4b91a0558ed3605949841f814eab273d20b66a164cfe4b632ef0` |

The base and PR test merges have the same trees as their respective reviewed revisions. The base tree is `f486ff208a24131c228a5a2d25651bae322a430f`. The PR tree is `2a82a6d7f1a3cb5f783d41b2ce9c5e75b6010e2d`.

Run in this case directory. The verifier also accepts the two full binding paths as arguments.

```sh
gh run download 45013328192 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45013338903 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```
