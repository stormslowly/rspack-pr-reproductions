# Stale compiler snapshots after a generated tree moves away

Case 34 now passes. This case varies which subscriptions survive and whether another scan reads a child before the move. It uses a real Rspack watch compiler, ordinary loader dependencies, and filesystem renames. A JavaScript `ignored` callback slows an independent move event so the loader can change its subscriptions while a directory discovery is queued. The file and the nested context are both absent on disk before the event processor resumes. The verifier reads the timestamps on the resulting rebuild.

| Mode | Subscriptions and timing | Merge base and main | Reviewed PR |
| --- | --- | --- | --- |
| `plain` | Retire the outer context, keep the generated directory as a missing dependency, and keep its child as a file dependency. | Removed child's timestamp is `null`. | `null`. The previous case remains fixed. |
| `only-file` | Keep the explicit child file dependency. The outer context retires and the parent has no missing subscription. | On an independent file's rebuild, the deleted child's timestamp is `null`. | The rebuild exposes `1600000000123` for the child. Neither version reports the unsubscribed parent in this mode. |
| `rescan` | Keep the parent missing subscription. After the outer context retires, briefly subscribe to the nested directory and scan the unchanged child. Retire that nested context, then move the tree away. | The rebuild lists the parent in `removedFiles` and the child timestamp is `null`. | The parent is removed and the child still has `1600000000123`. |
| `retained-context` | Keep the nested directory as an explicit context from the original scan onward. It contains a file discovered only through that context. | The registered nested directory has a `null` context entry. Its discovered file has no timestamp. | The nested directory has a `safeTime`, and its discovered file still has `1600000000123`. |

`only-file` waits for a real write to a separately watched control file. The context notification has no remaining recipient and is dropped before the subtree is checked, even though its child is still a file dependency. The merge base reconciles the subtree before selecting notification recipients. [Early return](https://github.com/web-infra-dev/rspack/blob/34426f2825f5e0cf4863cc86878cbe2266b94c36/crates/rspack_watcher/src/trigger.rs#L238-L246) · [Merge-base removal handling](https://github.com/web-infra-dev/rspack/blob/84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3/crates/rspack_watcher/src/trigger.rs#L264-L279)

In `rescan`, the second scan observes the file after the original discovery but before the removal. No write to the child occurs between those scans. On delivery, a fresh metadata lookup confirms the parent is missing. The comparison with the original scan's epoch preserves the earlier positive child observation. [Metadata check and descendant guard](https://github.com/web-infra-dev/rspack/blob/34426f2825f5e0cf4863cc86878cbe2266b94c36/crates/rspack_watcher/src/trigger.rs#L441-L465)

In `retained-context`, the reconciliation loop considers explicit file and missing dependencies. It leaves the retained context and its discovered member in the snapshot. [Descendant selection](https://github.com/web-infra-dev/rspack/blob/34426f2825f5e0cf4863cc86878cbe2266b94c36/crates/rspack_watcher/src/paths.rs#L618-L628) · [Directory snapshot](https://github.com/web-infra-dev/rspack/blob/34426f2825f5e0cf4863cc86878cbe2266b94c36/crates/rspack_watcher/src/paths.rs#L1465-L1477)

## Run on Linux x86-64

Use a filesystem with directory birth-time support. Run these commands from this directory. The default command runs each mode against both bindings in fresh Node processes. To run one comparison, pass its mode, for example `node verify.mjs rescan`.

```sh
npm install --prefix . --no-save --package-lock=false --ignore-scripts @rspack/core@2.3.4
gh run download 45760927028 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D main
gh run download 45765059828 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

Every row gave the same outcome in five paired runs on Linux with Node.js 22.16.0. The PR result was also checked against the JavaScript built from the PR CI sources. The original merge base was checked with a matching JavaScript build. To run an individual pair of native and JavaScript artifacts, use `node verify.mjs --worker /path/to/binding.node MODE /path/to/core/dist/index.js`.

| CI binding | Commit built | Binding SHA-256 |
| --- | --- | --- |
| [Original merge base](https://github.com/web-infra-dev/rspack/actions/runs/45339599582/job/138259974230) | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3` | `5b3dfd4aeb9ce00820edcd2e7f157b9c9043e7b286d645c33a647cce3d50bcbc` |
| [Main before the PR test merge](https://github.com/web-infra-dev/rspack/actions/runs/45760927028/job/139710627265) | `f4c7aca222458dcf5a56b65e2eb0fb6120b3d200` | `4bf707f4e1cdd69ee3ef3c674c03d9320176f8a1e8f6bb5c4445fa5a73c01f45` |
| [PR CI](https://github.com/web-infra-dev/rspack/actions/runs/45765059828/job/139724195872) | `d400111f8aedb8ed68a754dfce4a46e8249d5078` | `c62f4d8ff168e202df9852abc3f2fcb2d1ce25a40287511f403f9900d622998b` |

The PR CI commit has first parent `f4c7aca222458dcf5a56b65e2eb0fb6120b3d200` and second parent `34426f2825f5e0cf4863cc86878cbe2266b94c36`. Its production watcher and native watcher binding sources match the reviewed head.
