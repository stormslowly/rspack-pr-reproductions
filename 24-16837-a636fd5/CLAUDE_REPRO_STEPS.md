# Creating a file can reset its directory's safe time on Linux

Register a context and a missing dependency under it. Use an extra separator in the missing dependency, such as `src//components/optional.js`. The initial scan finds `src/components` and its existing files. Creating `src/components/new.js` gives the Linux watcher a real event with the spelling `src//components/new.js`.

The directory's `safeTime` should cover the new file. On the reviewed revision, the snapshot can return zero for the directory while returning the current safe time for the file. The two paths name the same physical directory. A plugin can supply this input through its context and missing dependencies. The comparison measures the timestamp API.

## Run

Use Linux x86-64 with glibc and Node.js 22. From this case directory, download the two Linux bindings and run the verifier.

```sh
gh run download 45195412468 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45199018921 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

For predownloaded bindings, run `node verify.mjs /absolute/path/to/base.node /absolute/path/to/head.node`.

| Build | Revision |
| --- | --- |
| [Control artifact](https://github.com/web-infra-dev/rspack/actions/runs/45195412468/artifacts/14827837030) | Merge base `1a342f96153b9ebc8ebae895e5d693f744b51a82` |
| [PR artifact](https://github.com/web-infra-dev/rspack/actions/runs/45199018921/artifacts/14830058151) | Test merge `241f47a3ccb592a8ebacaa47e207d688bf65d242` |
| [Reviewed revision](https://github.com/web-infra-dev/rspack/commit/a636fd56582d1a0839f54c1a085b948bd4756bdd) | Head `a636fd56582d1a0839f54c1a085b948bd4756bdd` |

The merge parents, in order, are the control and the reviewed head. The merge and the head have the same Git tree.

## Observed on Linux

The verifier repeats the same operation in 32 directories with 48 existing files each. It runs the bindings in separate processes against the same absolute paths and waits for each new file to appear in the snapshot. A fresh temporary root for the next run changes the hash-table traversal order.

| Directories returning zero after the write | Merge base | Reviewed head |
| --- | ---: | ---: |
| First run, Node.js 22.16.0 | 0 of 32 | 19 of 32 |
| Second run, Node.js 22.16.0 | 0 of 32 | 20 of 32 |

In the first run, `components-0` initially reported `1711965600331` in both builds. On base, its safe time advanced to the new file's `1795455265279`. On head it fell to `0` while the new file reported `1795455265356`.

Both revisions merge parent paths that compare equal and use the first spelling to look up directory records. On Unix those records distinguish the raw spellings. The PR visits all files for a given parent together. When the parent spelled with `//` is visited first, its file time is applied to that spelling and the scanned directory loses the contribution of all its existing files as well. This amplifies the existing dependency on traversal order. [Changed iteration](https://github.com/web-infra-dev/rspack/blob/a636fd56582d1a0839f54c1a085b948bd4756bdd/crates/rspack_watcher/src/paths.rs#L1123-L1135) · [Parent lookup](https://github.com/web-infra-dev/rspack/blob/a636fd56582d1a0839f54c1a085b948bd4756bdd/crates/rspack_watcher/src/paths.rs#L1157-L1180)
