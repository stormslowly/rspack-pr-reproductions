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

Run on Linux x86-64 with glibc and Node.js 22. Case 04 requires an unprivileged user. Case 05 uses a private user namespace and util-linux `unshare`. All four cases execute the native CI bindings. From the repository root run the following commands.

```sh
gh run download 44908894098 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D base
gh run download 44974533703 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node 03-16803-79f0b66/verify.mjs
node 04-16803-79f0b66/verify.mjs
node 05-16803-79f0b66/verify.mjs
node 06-16803-79f0b66/verify.mjs
```
