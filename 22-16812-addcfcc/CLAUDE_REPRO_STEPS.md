# A single registration under /tmp makes the macOS watcher subscribe to /

On macOS, `/tmp` is a directory symlink to `/private/tmp`. Register one file using its `/tmp/<project>/entry.js` spelling and the default `followSymlinks` setting. The new root analyzer stops at the first directory symlink. Here the first link is directly below `/`, so the recursive watch starts at the filesystem root. [Reviewed condition](https://github.com/web-infra-dev/rspack/blob/addcfcc08ae28f5894081303bd59bdca55c7c3f7/crates/rspack_watcher/src/analyzer/root.rs#L157).

The verifier waits for initial registration, edits the watched file, and creates 16 files in a separate fixture outside `/private/tmp`. It counts distinct fixture paths seen by a JavaScript `ignored` predicate. It discards unrelated events immediately. The in-project control write reached the event filter on each build.

| Distinct unrelated files passed to the predicate | Expected | Merge base | PR |
| --- | ---: | ---: | ---: |
| Out of 16 writes | 0 | 0 | 16 |

This measures event processing on the callback path. The probe files are never registered as dependencies.

Verified on Apple Silicon with macOS 27.0 and Node.js 22.23.2. The control used merge base `f2c72390841090fcd329112dc551b423400758d6`. The PR artifact used merge `bc92be81470a93a6a951f6a32b679fdc7ccad2a5` with parents `53a62a5858b201e1500ddc55b0611c355fa74209` and `addcfcc08ae28f5894081303bd59bdca55c7c3f7`. The extra main-branch commit changes HMR. The watcher source matches the reviewed head. [Control build](https://github.com/web-infra-dev/rspack/actions/runs/45032083932/job/137238187775) · [PR build](https://github.com/web-infra-dev/rspack/actions/runs/45087588620/job/137409777061).

Run from the reproduction repository root with a macOS ARM64 Node.js process.

```sh
gh run download 45032083932 -R web-infra-dev/rspack -n bindings-aarch64-apple-darwin -D base
gh run download 45087588620 -R web-infra-dev/rspack -n bindings-aarch64-apple-darwin -D head
node 22-16812-addcfcc/verify.mjs
```
