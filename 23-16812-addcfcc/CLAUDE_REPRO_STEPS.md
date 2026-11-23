# Re-registering unchanged dependencies walks every explicit path back to its root

A rebuild can pass empty added and removed sets while retaining thousands of resolver misses. The root analyzer now visits every explicit tree node, walks each path's ancestors, and only then deduplicates their common root. The old analyzer started from a single tree node on the same-volume fixture. [Reviewed loop](https://github.com/web-infra-dev/rspack/blob/addcfcc08ae28f5894081303bd59bdca55c7c3f7/crates/rspack_watcher/src/analyzer/root.rs#L88).

The verifier registers missing `packages/app/src/module-N/index.js` paths under one real project. After registration it submits empty watch updates. An ignored marker in the following request establishes that the native owner finished processing prior requests. Each sample covers six updates between consecutive markers. The table gives the median of five samples, excluding fixture creation and initial registration.

| Retained missing paths | Merge base, ms per update | PR, ms per update |
| ---: | ---: | ---: |
| 1,000 | 0.098 | 1.034 |
| 20,000 | 0.449 | 14.007 |
| 50,000 | 0.512 | 48.942 |

Expected behavior is that an empty update with one unchanged physical root takes roughly the same time as the dependency set grows. Observed times are for the watch registration itself. The verifier prints all samples and compares the two builds in separate Node.js processes.

Verified on Apple Silicon with macOS 27.0 and Node.js 22.23.2. The control used merge base `f2c72390841090fcd329112dc551b423400758d6`. The PR artifact used merge `bc92be81470a93a6a951f6a32b679fdc7ccad2a5` with parents `53a62a5858b201e1500ddc55b0611c355fa74209` and `addcfcc08ae28f5894081303bd59bdca55c7c3f7`. The extra main-branch commit changes HMR. The watcher source matches the reviewed head. [Control build](https://github.com/web-infra-dev/rspack/actions/runs/45032083932/job/137238187775) · [PR build](https://github.com/web-infra-dev/rspack/actions/runs/45087588620/job/137409777061).

Run from the reproduction repository root with a macOS ARM64 Node.js process.

```sh
gh run download 45032083932 -R web-infra-dev/rspack -n bindings-aarch64-apple-darwin -D base
gh run download 45087588620 -R web-infra-dev/rspack -n bindings-aarch64-apple-darwin -D head
node 23-16812-addcfcc/verify.mjs
```
