# A rebuild can lose timestamps for existing nested directories

Run Rspack in watch mode with `experiments.nativeWatcher` enabled. The entry uses a recursive `require.context` on `./src`. Each of eight features has a `pages` directory containing a matching route. The initial watcher snapshot has a timestamp for all eight directories.

Edit the entry to add a separate `require.context` for each `pages` directory and one for `./src/lib`. After this edit builds, an `afterDone` hook queues `watching.invalidate()` on the next tick. The following `watchRun` reads `compiler.contextTimestamps`. The parent context remains active and none of its directories change on disk, so all eight directory keys should still be present.

## Run on Linux

Use Linux x86-64 with glibc and Node.js 22. From this case directory, download the two CI bindings and the matching JavaScript package.

```sh
gh run download 45195412468 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45199018921 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
npm pack @rspack-canary/core@2.3.4-canary-1a342f96-20261123171940 --ignore-scripts --registry=https://registry.npmjs.org
tar -xzf rspack-canary-core-2.3.4-canary-1a342f96-20261123171940.tgz
node verify.mjs
```

| Component | Revision |
| --- | --- |
| [Base Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/45195412468/artifacts/14827837030) | `1a342f96153b9ebc8ebae895e5d693f744b51a82` |
| [PR Linux binding](https://github.com/web-infra-dev/rspack/actions/runs/45199018921/artifacts/14830058151) | Test merge `241f47a3ccb592a8ebacaa47e207d688bf65d242` |
| [Reviewed head](https://github.com/web-infra-dev/rspack/pull/16837) | `a636fd56582d1a0839f54c1a085b948bd4756bdd` |
| [JavaScript package for both bindings](https://github.com/web-infra-dev/rspack/actions/runs/45223571078/job/137873731602) | Canary built from the base revision |

The test merge's first parent is the base and its second parent is the reviewed head. Its Git tree matches the head. The PR changes only Rust code and tests.

## Observed with Node.js 22.16.0

Each invocation runs each side four times in fresh compiler processes against the same physical paths. All three builds must succeed on every trial. The verifier also waits for all eight directories to have timestamps before the edit and after the final watch settles. Two invocations produced the following counts.

| Entries missing from a single `watchRun` (out of eight) | Trial 1 | Trial 2 | Trial 3 | Trial 4 |
| --- | ---: | ---: | ---: | ---: |
| Base, first invocation | 0 | 0 | 0 | 0 |
| Reviewed head, first invocation | 8 | 8 | 0 | 5 |
| Base, second invocation | 0 | 0 | 0 | 0 |
| Reviewed head, second invocation | 6 | 8 | 8 | 0 |

The counts depend on scheduling. On the reviewed head, the timestamp collector first copies the explicitly watched directories, then walks both file and directory members. It looks up each member in the live registration set. A directory registered in between is absent from the first list and skipped in the second pass. The base checked the same live set, but it finished visiting files before copying the directory list. [Base collector](https://github.com/web-infra-dev/rspack/blob/1a342f96153b9ebc8ebae895e5d693f744b51a82/crates/rspack_watcher/src/paths.rs#L1127-L1147) · [PR collector](https://github.com/web-infra-dev/rspack/blob/a636fd56582d1a0839f54c1a085b948bd4756bdd/crates/rspack_watcher/src/paths.rs#L1121-L1135) · [Compiler timestamp assignment](https://github.com/web-infra-dev/rspack/blob/a636fd56582d1a0839f54c1a085b948bd4756bdd/packages/rspack/src/Watching.ts#L317-L340)
