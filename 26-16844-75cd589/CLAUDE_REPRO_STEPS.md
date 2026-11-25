# Unsubscribing an inner context during a subtree scan drops entries from its retained outer context

Watch both an outer context (`src`) and a nested inner context (`src/pages`), then move a populated directory (`src/pages/admin`, containing `route.js` and `nested/deep.js`) into `src/pages`. `EventProcessor` marks `src/pages/admin` as a known directory member and starts `scan_below([".../src/pages/admin"])` to index its contents.

`scan_below` binds each root's `Scan` guard to the nearest explicit context ancestor found by `dir.ancestors().find(...)`, which selects `src/pages`. While the walk awaits the JavaScript `ignored` predicate on the first child inside `src/pages/admin`, the verifier enqueues a watch update that unsubscribes `src/pages` while keeping the outer context `src` active, waiting on a trailing retired context until `PathManager::update` has applied the unsubscription.

| Snapshot under retained `src` | Base (`84a03cf`) | PR (`75cd589`) |
| --- | --- | --- |
| `fileTimestamps` entries | `src/existing.js`, `src/pages/admin/nested/deep.js`, `src/pages/admin/route.js` | `src/existing.js` |
| `directoryTimestamps` entries | `src`, `src/pages`, `src/pages/admin`, `src/pages/admin/nested` | `src`, `src/pages`, `src/pages/admin` |

Once `src/pages` unsubscribes, `with_current`, `can_scan_children`, and `observe` reject every remaining write from that `Scan` even though `src` still covers the subtree. Because `src/pages/admin` was already recorded as `MemberKind::Directory` and `forget_context_entries_under` preserves entries still below `src`, later directory metadata events on `src/pages/admin` also treat it as already scanned and never index its descendants. [Nearest-context binding](https://github.com/web-infra-dev/rspack/blob/75cd589bb8710b12122e6e81982a92a45a09d3f9/crates/rspack_watcher/src/paths.rs#L748-L756) · [Single-root scan check](https://github.com/web-infra-dev/rspack/blob/75cd589bb8710b12122e6e81982a92a45a09d3f9/crates/rspack_watcher/src/paths.rs#L467-L484) · [Base orphan check](https://github.com/web-infra-dev/rspack/blob/84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3/crates/rspack_watcher/src/paths.rs#L737-L739)

## Live comparison

The runs use Linux x86-64, glibc 2.36, kernel 5.15 and Node.js 22.16.0. The verifier loads each CI binding in its own Node process.

| Build | Commit built by CI | Parents in order | Binding SHA-256 |
| --- | --- | --- | --- |
| [Base job](https://github.com/web-infra-dev/rspack/actions/runs/45339599582/job/138259974230) | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3` | `5aafd66b4090f76569d3a42020cb5d371a3bd2df` | `5b3dfd4aeb9ce00820edcd2e7f157b9c9043e7b286d645c33a647cce3d50bcbc` |
| [PR job](https://github.com/web-infra-dev/rspack/actions/runs/45340563950/job/138263110271) | `0a3edf37ca9cf9b3351062f177c6a481a5d77791` | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3`, `75cd589bb8710b12122e6e81982a92a45a09d3f9` | `adc4d7599fe6256cdd81dbaf797a0c6eebc0a2616cba104f31a70461a820c599` |

The PR test merge has the same Git tree (`85618d8253081af881e2b1636037683e5ac5cf4d`) as the reviewed revision `75cd589bb8710b12122e6e81982a92a45a09d3f9`. The base tree is `69736df23f4428fa1db36ba95b7c1c256d38e494`.

Run in this case directory. The verifier also accepts the two full binding paths as arguments.

```sh
gh run download 45339599582 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45340563950 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```
