# Stats JSON loses a field added by a wrapped factory

A plugin wraps the compilation instance's public `createStatsFactory(options)` method, delegates to the original and taps the returned factory to add `buildId: 'ci-42'` to the JSON. A one-module build succeeds on both revisions. The PR's early return skips the wrapper when the compilation has only its built-in factory tap. [Method on Compilation](https://github.com/web-infra-dev/rspack/blob/96262afbce781e7237339397c43e2c4d587544b8/packages/rspack/src/Compilation.ts#L718-L722) · [Early return](https://github.com/web-infra-dev/rspack/blob/de0d01724fd9255d46f4c53ab7f38abf3cb68ecd/packages/rspack/src/Stats.ts#L129-L133)

## Expected and observed

Each call to `stats.toJson({ all: false, hash: true })` should include the build ID. The verifier calls it twice on the same compilation, adding an empty `compilation.hooks.statsFactory` tap before the second call. Each revision runs in a fresh Node.js process.

| Revision | Ordinary call | After adding an empty factory tap |
| --- | --- | --- |
| Merge base `96262afb` | Wrapper called once, `buildId` is `ci-42` | Wrapper called once, `buildId` is `ci-42` |
| PR head `de0d017` | Zero wrapper calls, `buildId` is absent | Wrapper called once, `buildId` is `ci-42` |

Three Linux x86-64 runs produced the same result on Node.js 22.16.0 and glibc 2.36. Both builds produced a nonempty hash. A fourth comparison used the base native binding for both JavaScript builds and reproduced the same difference.

## Run the comparison

From this case directory, use Bash, an authenticated GitHub CLI, and the repository's pnpm 12.23.0. The following builds only `@rspack/core` and downloads each revision's Linux x86-64 GNU binding.

```bash
set -eu
area=$(mktemp -d)
prepare() {
  local name=$1 rev=$2 run=$3
  local checkout="$area/$name"
  git init -q "$checkout"
  git -C "$checkout" fetch -q --depth=1 https://github.com/web-infra-dev/rspack.git "$rev"
  git -C "$checkout" checkout -q --detach FETCH_HEAD
  gh run download "$run" -R web-infra-dev/rspack \
    -n bindings-x86_64-unknown-linux-gnu -D "$area/$name-binding"
  cp "$area/$name-binding/rspack.linux-x64-gnu.node" "$checkout/crates/node_binding/"
  (
    cd "$checkout"
    pnpm install --frozen-lockfile
    pnpm --filter @rspack/core run build
  )
}
prepare base 96262afbce781e7237339397c43e2c4d587544b8 45586445766
prepare head de0d01724fd9255d46f4c53ab7f38abf3cb68ecd 45949786767
node verify.mjs "$area/base/packages/rspack/dist/index.js" "$area/head/packages/rspack/dist/index.js"
```

## Artifacts

| JavaScript and native revision | Binding SHA-256 |
| --- | --- |
| [Merge base `96262afbce781e7237339397c43e2c4d587544b8`](https://github.com/web-infra-dev/rspack/actions/runs/45586445766/job/139109507097) | `966246aa8f079b7e5efbce71e75a7cdab3a0887938063b46c25267e0492bcef4` |
| [PR head `de0d01724fd9255d46f4c53ab7f38abf3cb68ecd`](https://github.com/web-infra-dev/rspack/actions/runs/45949786767/job/140342729853) | `4a4d0e54a0d3f2c3b7f19d8fb358c5bf645202d2f20b6657635c4341b2a9b8c8` |

GitHub's test merge `1e8997765968b6d885670df6759f693f4cb704c5` had parents `3bd22197b56c36a27dea0e5a4a6ea110858ac9c4` and `de0d01724fd9255d46f4c53ab7f38abf3cb68ecd`. The PR's CI Diff build checked out the head directly. [Workflow definition](https://github.com/web-infra-dev/rspack/blob/de0d01724fd9255d46f4c53ab7f38abf3cb68ecd/.github/workflows/ci-diff.yml#L44-L52)
