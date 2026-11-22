# Rspack PR reproductions

Small, independently runnable reproductions of issues found while reviewing Rspack
pull requests. Case directories use `NN-PR_ID-SHORT_COMMIT_ID`.

| Case | Pull request | Reviewed commit | Problem |
| --- | --- | --- | --- |
| [01-16770-6580852](01-16770-6580852/CLAUDE_REPRO_STEPS.md) | [#16770](https://github.com/web-infra-dev/rspack/pull/16770) | `6580852` | An ignored TypeScript path overrides an explicit browser alias. |
| [02-16770-6580852](02-16770-6580852/CLAUDE_REPRO_STEPS.md) | [#16770](https://github.com/web-infra-dev/rspack/pull/16770) | `6580852` | An ignored relative file overrides the importer's browser mapping. |
| [03-16803-79f0b66](03-16803-79f0b66/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `79f0b66` | Replacing or downgrading a recursive parent drops the child watch on Linux. |
| [04-16803-79f0b66](04-16803-79f0b66/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `79f0b66` | A failed recursive upgrade loses a working file subscription. |
| [05-16803-79f0b66](05-16803-79f0b66/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `79f0b66` | Replacing a watch at the inotify quota fails on every retry. |
| [06-16803-79f0b66](06-16803-79f0b66/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `79f0b66` | Native re-registration time grows quadratically with the directory count. |
| [07-16803-8103c48](07-16803-8103c48/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `8103c48` | Downgrading a child silently breaks its retained recursive ancestor. |
| [08-16803-8103c48](08-16803-8103c48/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `8103c48` | A downgrade drops concurrent writes and loses a working watch on reattachment failure. |
| [09-16803-8103c48](09-16803-8103c48/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `8103c48` | Bulk mode downgrades of disjoint directories take quadratic time on Linux. |
| [10-16804-50e590b](10-16804-50e590b/CLAUDE_REPRO_STEPS.md) | [#16804](https://github.com/web-infra-dev/rspack/pull/16804) | `50e590b` | The macOS context watch narrows to its only child and misses new siblings. |
| [11-16804-50e590b](11-16804-50e590b/CLAUDE_REPRO_STEPS.md) | [#16804](https://github.com/web-infra-dev/rspack/pull/16804) | `50e590b` | Creating an entry inside a missing dependency that became a directory produces no event. |
| [12-16804-50e590b](12-16804-50e590b/CLAUDE_REPRO_STEPS.md) | [#16804](https://github.com/web-infra-dev/rspack/pull/16804) | `50e590b` | Moving a file with an aged mtime into nested contexts invalidates only one subscriber. |
| [13-16804-50e590b](13-16804-50e590b/CLAUDE_REPRO_STEPS.md) | [#16804](https://github.com/web-infra-dev/rspack/pull/16804) | `50e590b` | The outer context consumes the inner context's recovery before event delivery. |
| [14-16804-50e590b](14-16804-50e590b/CLAUDE_REPRO_STEPS.md) | [#16804](https://github.com/web-infra-dev/rspack/pull/16804) | `50e590b` | A watch update during the JavaScript ignored predicate delivers a revoked file. |
| [15-16804-50e590b](15-16804-50e590b/CLAUDE_REPRO_STEPS.md) | [#16804](https://github.com/web-infra-dev/rspack/pull/16804) | `50e590b` | Removing a directory subtree repeatedly compacts the same owner's subscription list. |
| [16-16803-1eb9e4f](16-16803-1eb9e4f/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `1eb9e4f` | Replacing a watched directory under the same name loses future edits. |
| [17-16803-1eb9e4f](17-16803-1eb9e4f/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `1eb9e4f` | Retrying a partially covered recursive root releases working watches after a permission or quota error. |
| [18-16803-1eb9e4f](18-16803-1eb9e4f/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `1eb9e4f` | Existing directory symlinks are skipped when following symlinks is enabled. |
| [19-16803-1eb9e4f](19-16803-1eb9e4f/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `1eb9e4f` | Installing and withdrawing a large recursive watch takes longer on Linux. |
| [20-16803-1eb9e4f](20-16803-1eb9e4f/CLAUDE_REPRO_STEPS.md) | [#16803](https://github.com/web-infra-dev/rspack/pull/16803) | `1eb9e4f` | An unclosed native watcher retains its inotify instance after garbage collection. |

The two #16770 cases support checking saved evidence with Node.js 22 or newer.

```sh
node <case-dir>/verify.mjs
```

To repeat the live comparisons for PR #16770, follow the setup in either case and run both verifiers with the downloaded bindings.

```sh
node 01-16770-6580852/verify.mjs --live "$work/base/$file" "$work/head/$file"
node 02-16770-6580852/verify.mjs --live "$work/base/$file" "$work/head/$file"
```

## Repeating the native watcher comparisons

Run on Linux x86-64 with glibc and Node.js 22. Cases 04 and 08 use an unprivileged user. Case 05 uses a private user namespace and util-linux `unshare`. The following commands run cases 03–06 against the first reviewed revision from the repository root.

```sh
gh run download 44908894098 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 44974533703 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node 03-16803-79f0b66/verify.mjs
node 04-16803-79f0b66/verify.mjs
node 05-16803-79f0b66/verify.mjs
node 06-16803-79f0b66/verify.mjs
```

Cases 07–09 compare the same base with the later PR revision `8103c48`. Each case also has standalone setup instructions.

```sh
gh run download 45013328192 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head-8103c48
file=rspack.linux-x64-gnu.node
node 07-16803-8103c48/verify.mjs "base/$file" "head-8103c48/$file"
node 08-16803-8103c48/verify.mjs "base/$file" "head-8103c48/$file"
node 08-16803-8103c48/concurrent-edits.mjs "base/$file" "head-8103c48/$file"
node 09-16803-8103c48/verify.mjs "base/$file" "head-8103c48/$file"
```
