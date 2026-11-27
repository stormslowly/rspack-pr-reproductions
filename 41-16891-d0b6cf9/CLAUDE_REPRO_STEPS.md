# A loader can lose its fallback when the resolver drops `error.code`

The loader tries a project-specific theme first. If Rspack reports `GenericFailure`, it resolves the supplied default theme. With the preferred file missing, an existing project using this error check compiled successfully before [PR #16891](https://github.com/web-infra-dev/rspack/pull/16891). The PR registers the missing file but the loader receives an error without the code, rethrows it, and the build fails. The [existing loader integration test](https://github.com/web-infra-dev/rspack/blob/0abaf0bac4c3de0841355348059a2447d6a32536/tests/rspack-test/configCases/loader/rspack-issue-4672/loader.mjs#L6-L10) explicitly checked this code.

## Observed on Linux x86-64 (glibc), Node.js 22.16.0

| Public loader API | Revision | `error.code` | Compilation errors | Bundle export | Missing preferred file tracked |
| --- | --- | --- | ---: | --- | --- |
| `this.resolve` callback | Merge base | `GenericFailure` | 0 | `DEFAULT` | No |
| `this.resolve` callback | PR head | `undefined` | 1 | No bundle | Yes |
| `this.getResolve()` Promise | Merge base | `GenericFailure` | 0 | `DEFAULT` | No |
| `this.getResolve()` Promise | PR head | `undefined` | 1 | No bundle | Yes |

Each build runs in a separate Node process against a fresh directory containing an empty entry and a working default theme. The loader records the actual code before deciding whether to rethrow. The verifier checks the compilation diagnostic, executes any emitted bundle, and reads the exact preferred path from `compilation.missingDependencies`.

Expected behavior on the PR is a tracked missing path **and** a working fallback for both API forms. [The new error is constructed here.](https://github.com/web-infra-dev/rspack/blob/d0b6cf9ebb99b316c59accd9efa7c179718eae75/packages/rspack/src/Resolver.ts#L88-L90)

## Revisions and artifacts

| | Exact source and native binding | Linux CI Diff build | Native binary SHA-256 |
| --- | --- | --- | --- |
| Merge base | `0abaf0bac4c3de0841355348059a2447d6a32536` | [45790881852](https://github.com/web-infra-dev/rspack/actions/runs/45790881852/job/139809306275) | `d01be1793b9ee8925754647b0eec53083fed824f86d5fae30d6f5669233e1fd1` |
| PR head | `d0b6cf9ebb99b316c59accd9efa7c179718eae75` | [45929138717](https://github.com/web-infra-dev/rspack/actions/runs/45929138717/job/140277426694) | `07f1a97b3e0091bbca4fbcc49a6009d48fa20a7c49b71f1e471207cfe3a53d63` |

The JavaScript package was built from each source revision. Both binaries are from the `bindings-x86_64-unknown-linux-gnu` artifacts above. The separate [PR test workflow](https://github.com/web-infra-dev/rspack/actions/runs/45929138619) tested merge commit `53fe3b4cc02501eb3c342a9f6c697939540441ec`, whose parents were `9efdfb10cb8197879a1b8466483a76799fba8973` and `d0b6cf9ebb99b316c59accd9efa7c179718eae75`.

## Run the comparison

With built Rspack checkouts available, run from this case directory.

```sh
node verify.mjs /path/to/merge-base-checkout /path/to/pr-head-checkout
```

To prepare both checkouts on Linux x86-64, use a Rspack clone, the project's pinned pnpm 12.23.0, and GitHub CLI access to the workflow artifacts. From this case directory, run the following in Bash.

```bash
set -e
repo=${RSPACK_REPO:-"$HOME/git/rspack"}
case_dir=$PWD
work="$repo/.codex/worktrees"
base=0abaf0bac4c3de0841355348059a2447d6a32536
head=d0b6cf9ebb99b316c59accd9efa7c179718eae75

git -C "$repo" fetch --no-tags origin "$base" "$head"

prepare() {
  local checkout="$1" commit="$2" run="$3"
  git -C "$repo" worktree add --detach "$checkout" "$commit"
  gh run download "$run" -R web-infra-dev/rspack \
    -n bindings-x86_64-unknown-linux-gnu -D "$checkout/crates/node_binding"
  (cd "$checkout" && pnpm install --frozen-lockfile && pnpm --filter @rspack/core run build)
}

prepare "$work/repro-16891-base" "$base" 45790881852
prepare "$work/repro-16891-head" "$head" 45929138717
node "$case_dir/verify.mjs" "$work/repro-16891-base" "$work/repro-16891-head"
```

If the artifacts have expired, build each checkout's native package with `pnpm run build:binding:dev` after installing its dependencies, then build `@rspack/core` and run the same verifier.
