# Removing a file alias releases a direct subscription to its target

Register a file through a symlink, register its real path in a second watch call, and remove only the symlink. The real file still has a direct subscriber. Its next edit should reach the aggregate callback in either registration order.

## Reviewed mapping code

`mapping.rs` calls the reviewed `LinkResolver` and `LinkMappings` with a real file, an actual symlink, and the crate's `PathTracker` instances. Both orders register exactly the same paths. Each row shows the target's reference count before removing the alias and its watch state afterwards.

| Registration order | References before removal | Target still watched |
| --- | ---: | --- |
| Real path, then alias | 2 | Yes |
| Alias, then real path | 1 | No |

When the first direct registration arrives, `bind_dep` tries to unbind it. The fallback sees the physical reference already owned by the alias and releases it. Removing the alias later takes the remaining reference. [Reviewed code](https://github.com/web-infra-dev/rspack/blob/addcfcc08ae28f5894081303bd59bdca55c7c3f7/crates/rspack_watcher/src/paths/links.rs#L613).

Run these commands from the reproduction repository root. `RSPACK_CHECKOUT` points to any Rspack clone with the reviewed commit. The export is disposable. The example includes the original watcher crate source and uses the toolchain pinned there.

```sh
source_dir=$(mktemp -d)
git -C "$RSPACK_CHECKOUT" archive addcfcc08ae28f5894081303bd59bdca55c7c3f7 | tar -x -C "$source_dir"
mkdir -p "$source_dir/crates/rspack_watcher/examples"
cp 21-16812-addcfcc/mapping.rs "$source_dir/crates/rspack_watcher/examples/review_link_refs.rs"
node 21-16812-addcfcc/verify.mjs --mapping "$source_dir"
```

## Native watcher behavior when the mapping is connected

With `followSymlinks: true`, the verifier edits both the target and an independently registered file after the alias is removed. The independent edit must be delivered on every run. The target edit is delivered as follows.

| Native binding | Real path first | Alias first |
| --- | --- | --- |
| Merge base | Delivered | Delivered |
| #16812, mapping has no production caller yet | Delivered | Delivered |
| #16813, mapping connected | Delivered | Missed |

Verified on Apple Silicon with macOS 27.0 and Node.js 22.23.2. The control used merge base `f2c72390841090fcd329112dc551b423400758d6`. The PR artifact used merge `bc92be81470a93a6a951f6a32b679fdc7ccad2a5` with parents `53a62a5858b201e1500ddc55b0611c355fa74209` and `addcfcc08ae28f5894081303bd59bdca55c7c3f7`. The extra main-branch commit changes HMR. The watcher source matches the reviewed head. [Control build](https://github.com/web-infra-dev/rspack/actions/runs/45032083932/job/137238187775) · [PR build](https://github.com/web-infra-dev/rspack/actions/runs/45087588620/job/137409777061).

The integration artifact used merge `ab9c4cfb48345d7ec5b8d35b7d43e4e17465661e` with parents `addcfcc08ae28f5894081303bd59bdca55c7c3f7` and `343eeef7cad5db36cdf3ff88e3c43d9901748388`. Both reviewed and integrated revisions have the same `links.rs` blob, `8e6d9110d2d32d9bf16cde218923d82cf39533b3`. [Integration build](https://github.com/web-infra-dev/rspack/actions/runs/45090884917/job/137420055308).

```sh
gh run download 45032083932 -R web-infra-dev/rspack -n bindings-aarch64-apple-darwin -D base
gh run download 45087588620 -R web-infra-dev/rspack -n bindings-aarch64-apple-darwin -D head
gh run download 45090884917 -R web-infra-dev/rspack -n bindings-aarch64-apple-darwin -D wired
node 21-16812-addcfcc/verify.mjs
```
