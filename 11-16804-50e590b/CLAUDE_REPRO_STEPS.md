# A recovered missing directory no longer reports edits to its contents

Register `unresolved-package` as a missing dependency while it does not exist. Create the empty directory and wait for its appearance to be delivered. Keep the dependency in the missing set for the next watch cycle, as a loader waiting for a package entry may do. Once the new cycle is active, create `unresolved-package/index.js`. A later write to a separate control file confirms that notifications are still being delivered.

| After writing `index.js` | Base | PR |
| --- | --- | --- |
| Immediate event | `unresolved-package/index.js` | none |
| Aggregated changed dependency | `unresolved-package` | none |

The previous ancestor lookup included registered missing paths. The new graph creates only an exact entry binding for each missing path. Children of the recovered directory have no subscription that can notify the missing dependency. [Entry registration](https://github.com/web-infra-dev/rspack/blob/50e590b31efa4877a3fb7714b66869d89b7362d3/crates/rspack_watcher/src/subscription.rs#L573-L585) · [Previous ancestor lookup](https://github.com/web-infra-dev/rspack/blob/8103c486f1139ce9b53797fb97202a392c5fc882/crates/rspack_watcher/src/trigger.rs#L62-L84)

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
