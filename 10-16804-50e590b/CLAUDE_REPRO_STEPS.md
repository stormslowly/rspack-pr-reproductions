# A scanned child replaces its registered parent as the macOS watch root

Register a directory context that has exactly one subdirectory. No individual file is registered. Wait for the initial scan, create `new.js` directly under the context, then create a control file inside the pre-existing subdirectory. Both writes go through the real filesystem and FSEvents.

| Observation | Base | PR |
| --- | --- | --- |
| Immediate event for `new.js` | yes | no |
| Root context reported changed before the control write | yes | no |
| Immediate event for the control file | yes | yes |

After scanning, the new physical watch for the discovered directory triggers a second analysis. The recursive-root analyzer follows its only directory child even when the parent was explicitly registered. Applying that narrower root drops coverage of new siblings. A context dependency used to discover new entries can therefore stay stale. This case was run on macOS. [Post-scan watch](https://github.com/web-infra-dev/rspack/blob/50e590b31efa4877a3fb7714b66869d89b7362d3/crates/rspack_watcher/src/lib.rs#L506-L507) · [Root selection](https://github.com/web-infra-dev/rspack/blob/50e590b31efa4877a3fb7714b66869d89b7362d3/crates/rspack_watcher/src/analyzer/root.rs#L87-L103)

## Live comparison

The runs use macOS 27.0 on Apple silicon with Node.js 22.23.2. The verifier loads each CI binding in its own Node process.

| Build | Commit built by CI | Parents in order | Binding SHA-256 |
| --- | --- | --- | --- |
| [Base job](https://github.com/web-infra-dev/rspack/actions/runs/45013328192/job/137180319566) | `da96e75601f2a53f9924db450c0cd308273a9544` | `0350265fd086a7caf45f1b00796133e5a753153c`, `8103c486f1139ce9b53797fb97202a392c5fc882` | `5c7caea2f35cacb01c1abe4a1c4397ff82673086778521a853f56a1ad76b82ac` |
| [PR job](https://github.com/web-infra-dev/rspack/actions/runs/45013338903/job/137180355037) | `8ca1aeb388d56439f37855be15c3408aa7bd7db9` | `8103c486f1139ce9b53797fb97202a392c5fc882`, `50e590b31efa4877a3fb7714b66869d89b7362d3` | `555ca7ab47c5b64bd03103a69cf2944caf1d41451f03c65a0cdf367df1c84ea1` |

The base and PR test merges have the same trees as their respective reviewed revisions. The base tree is `f486ff208a24131c228a5a2d25651bae322a430f`. The PR tree is `2a82a6d7f1a3cb5f783d41b2ce9c5e75b6010e2d`.

Run in this case directory. The verifier also accepts the two full binding paths as arguments.

```sh
gh run download 45013328192 -R web-infra-dev/rspack -n bindings-aarch64-apple-darwin -D base
gh run download 45013338903 -R web-infra-dev/rspack -n bindings-aarch64-apple-darwin -D head
node verify.mjs
```
