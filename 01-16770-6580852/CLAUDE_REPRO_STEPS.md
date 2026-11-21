# An ignored TypeScript path overrides an explicit browser alias

The entry imports `transport`. The application's TypeScript config maps it to `server.js`, which is disabled in the browser. Its bundler config explicitly aliases the exact request `transport$` to `browser.js`. webpack applies that explicit alias first. [webpack resolver order](https://github.com/webpack/enhanced-resolve/blob/66e2e72b992d779fe1063a09c3e855aae8e09ded/lib/ResolverFactory.js#L582-L590)

The base and webpack resolve `transport` to `browser.js` and the bundle exports `"browser transport"`. The PR stops at the disabled TypeScript path. Resolution returns `false` and the bundle exports `{}`. Direct resolution of `./server.js` returns `false` in all three builds.

## Run the comparison

Use Linux x86-64 with glibc and Node.js 22.16 or newer. From this case directory, install the JavaScript wrapper built from the base commit and webpack. The two runs share the wrapper and each loads its own native CI binary.

```sh
work=$(mktemp -d)
npm install --prefix "$work" --no-save --no-package-lock --ignore-scripts \
  @rspack-canary/core@2.3.4-canary-8e506f27-20261120172223 webpack@5.112.2 enhanced-resolve@5.27.0
export NODE_PATH="$work/node_modules"
artifact=bindings-x86_64-unknown-linux-gnu
gh run download 44714715207 -R web-infra-dev/rspack -n "$artifact" -D "$work/base"
gh run download 44801695822 -R web-infra-dev/rspack -n "$artifact" -D "$work/head"
file=rspack.linux-x64-gnu.node
node verify.mjs --live "$work/base/$file" "$work/head/$file"
```

To examine one build, run `node run.mjs webpack` or pass the absolute path to one of the bindings. `node verify.mjs` checks the captured comparison in `evidence.json` without installing dependencies.

## Revisions

The base CI build checked out `8e506f27445c4638dec89a721a87b1bae9af1a44`. The PR build checked out `328d8744bc9a74c22b8b3cda3db1e3b76e410d0f`, whose first parent is that base and whose second parent is the reviewed commit `6580852d325c1a2f2681c781da6bd2ce3dad982a`. The merge tree matches the reviewed commit. [Base build](https://github.com/web-infra-dev/rspack/actions/runs/44714715207/job/136215254003) · [PR build](https://github.com/web-infra-dev/rspack/actions/runs/44801695822/job/136515457200) · [JavaScript wrapper](https://github.com/web-infra-dev/rspack/actions/runs/44779480564)
