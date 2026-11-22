# Removing a context subtree repeatedly scans the same subscription list

Create a context with a subtree containing thousands of empty sibling directories. Register one missing two-component path under the context to request recursive coverage on both revisions. Both have exactly the same kernel watch count, checked using `/proc/self/fdinfo`. Rename the subtree out of the context and time the interval up to the immediate removal notification on the JavaScript side. The fixture uses the same filesystem for both sides of the rename.

The runs below each contain three fresh watcher registrations and three renames per size and revision. Reported values are medians in milliseconds. Initial registration is timed from `watch()` to the initial scan notification for a control file. Creating the fixture, waiting for its timestamps to age, and closing the watcher are outside the intervals.

| Descendant directories | Inotify watches | Base removal, runs 1 / 2 | PR removal, runs 1 / 2 | Base registration, runs 1 / 2 | PR registration, runs 1 / 2 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 4,000 | 4,003 | 1.41 / 1.50 | 7.59 / 7.59 | 84.70 / 82.56 | 154.36 / 156.47 |
| 8,000 | 8,003 | 2.01 / 2.01 | 20.46 / 19.94 | 161.03 / 163.01 | 303.29 / 315.32 |
| 16,000 | 16,003 | 4.48 / 5.06 | 66.91 / 65.29 | 345.65 / 330.35 | 680.08 / 632.76 |

For each removed child binding, the graph filters the complete remaining list of subscription IDs owned by the same context. Removing N children of one context can therefore visit O(N²) IDs while holding the graph mutex. This is one identified cost in the end-to-end removal measurement. The initial registration column measures a separate path that scans and binds the directories. [Removal loop](https://github.com/web-infra-dev/rspack/blob/50e590b31efa4877a3fb7714b66869d89b7362d3/crates/rspack_watcher/src/subscription.rs#L434-L439) · [Registration after the scan](https://github.com/web-infra-dev/rspack/blob/50e590b31efa4877a3fb7714b66869d89b7362d3/crates/rspack_watcher/src/lib.rs#L500-L507)

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
