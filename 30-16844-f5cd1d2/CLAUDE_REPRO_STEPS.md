# A restored directory drops out of the watcher's changed files

A build sees `src/pages/restored` as missing and watches `src` as a context. Before the watcher starts, a directory appears at the missing path with a new birth time and an old modification time, as when extracting an archive that preserves timestamps. The test registers the context and the missing path in the same watch call. It waits for the first aggregate and for a later edit to an independent control file.

| Included in the watcher's `changedFiles` | Merge base | Previous PR revision `000ba94` | Reviewed PR `f5cd1d2` |
| --- | --- | --- | --- |
| Watched parent `src` | Yes | Yes | Yes |
| Registered missing path `src/pages/restored` | Yes | Yes | No |

The merge base and reviewed PR gave these results in all five comparisons. When the directory keeps its current mtime, the reviewed PR reports both paths. Directory discovery uses birth time and finds the change in either case. When delivering the context notification, the PR's filter removes the directory itself because it is registered only as missing. The separate missing-dependency scan checks mtime, so it has no notification to add for the restored timestamp. [Context scan](https://github.com/web-infra-dev/rspack/blob/f5cd1d2ff1ae0d6ba8b8093f3a08d10bb59b9826/crates/rspack_watcher/src/paths.rs#L877-L898) · [Delivery filter](https://github.com/web-infra-dev/rspack/blob/f5cd1d2ff1ae0d6ba8b8093f3a08d10bb59b9826/crates/rspack_watcher/src/trigger.rs#L441-L453) · [Missing-dependency scan](https://github.com/web-infra-dev/rspack/blob/f5cd1d2ff1ae0d6ba8b8093f3a08d10bb59b9826/crates/rspack_watcher/src/scanner.rs#L108-L127)

## Reproduce on Linux

Run from this directory on Linux x86-64 with glibc, Node.js 22, and a filesystem that exposes directory birth time. The reported runs used Node.js 22.16.0. Each worker loads a real native watcher in a fresh process.

```sh
gh run download 45339599582 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 45666007535 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

| CI binding | Commit built | Binding SHA-256 |
| --- | --- | --- |
| [Merge base](https://github.com/web-infra-dev/rspack/actions/runs/45339599582/job/138259974230) | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3` | `5b3dfd4aeb9ce00820edcd2e7f157b9c9043e7b286d645c33a647cce3d50bcbc` |
| [PR test merge](https://github.com/web-infra-dev/rspack/actions/runs/45666007535/job/139388537232) | `0114306f1e8419d80cd61301f6e4910d23eef10b` | `10a08c61da50462a85a78df20e98bf3cdeea6e957cf423450824c761f9143393` |
| [Main at the time of PR CI](https://github.com/web-infra-dev/rspack/actions/runs/45604847432/job/139173205771) | `f9a8ef34466814e5eae706892701f6c933bd4fe0` | `7b5350c2bd3be28ed6ef4c3d80697559791deb975f2dba86352e790bdcfd0990` |

The test merge's parents are `f9a8ef34466814e5eae706892701f6c933bd4fe0` and the reviewed head `f5cd1d2ff1ae0d6ba8b8093f3a08d10bb59b9826`, in that order. Its watcher and native watcher binding sources match the reviewed head. Running the same verifier against the first parent also reports both paths on main and only the context on the PR. The preceding PR revision `000ba94522c7bb2f656563d52d8e43af7baa175d` reports both. [Previous PR build](https://github.com/web-infra-dev/rspack/actions/runs/45623309153/job/139237156356)

## Verify the emitted bundle

`verify-compiler.mjs` starts a real Rspack watch build with two modules. The loader registers `src` as the context dependency of one module. For the other module, it registers the missing directory and exports whether it exists. The first bundle exports `absent`. The script creates the directory with its preserved mtime before Rspack installs the watch, waits for the automatic rebuild, and executes the new bundle.

In three runs with the same published JavaScript package, main's rebuilt bundle exported `present`. On the PR the rebuild happened, but `compiler.modifiedFiles` omitted the restored directory and the bundle still exported `absent`. The first-parent and PR CI binaries both use the 2.3.4 JavaScript interface. The preceding PR revision also rebuilt to `present`.

```sh
gh run download 45604847432 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D main
npm install --prefix . --no-save --package-lock=false --ignore-scripts @rspack/core@2.3.4
node verify-compiler.mjs
```
