# Rspack PR reproductions

Small, independently runnable reproductions of issues found while reviewing Rspack
pull requests. Case directories use `NN-PR_ID-SHORT_COMMIT_ID`.

| Case | Pull request | Reviewed commit | Problem |
| --- | --- | --- | --- |
| [01-16770-6580852](01-16770-6580852/CLAUDE_REPRO_STEPS.md) | [#16770](https://github.com/web-infra-dev/rspack/pull/16770) | `6580852` | An ignored TypeScript path overrides an explicit browser alias. |
| [02-16770-6580852](02-16770-6580852/CLAUDE_REPRO_STEPS.md) | [#16770](https://github.com/web-infra-dev/rspack/pull/16770) | `6580852` | An ignored relative file overrides the importer's browser mapping. |

Each case is self-contained. Check its saved evidence with Node.js 22 or newer,
without installing dependencies:

```sh
node <case-dir>/verify.mjs
```

To repeat the live comparisons for PR #16770, follow the setup in either case and run both verifiers with the downloaded bindings.

```sh
node 01-16770-6580852/verify.mjs --live "$work/base/$file" "$work/head/$file"
node 02-16770-6580852/verify.mjs --live "$work/base/$file" "$work/head/$file"
```
