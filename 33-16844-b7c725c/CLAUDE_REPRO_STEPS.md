# The restored-directory compiler test depends on process-wide timestamp precision

The new compiler case expects the third rebuild to contain only `marker`. In a fresh process, the batch contains `marker`, `src`, and `restored`. Run the same case in a process where a watcher has already seen a file with a fractional-second mtime, and the assertion passes. [Original test](https://github.com/web-infra-dev/rspack/blob/b7c725c5ca805ea5a4e369c2690d39be047f3028/tests/rspack-test/compilerCases/native-watcher-restored-missing-directory.mjs#L21-L57)

The fixture gives the watched paths whole-second mtimes. The watcher starts with a 2,000 ms filesystem accuracy window, and a recent directory's birth time can still qualify for a subsequent scan. Learning timestamp precision is shared across watchers in the process. A control fixture with `const old = 1_600_000_000.123` passed in isolation on Linux with Node.js 22.22.3 and 24.19.0. The original fixture failed at line 57 on both versions. The full Linux CI suite passed the case. [Accuracy and safe time](https://github.com/web-infra-dev/rspack/blob/b7c725c5ca805ea5a4e369c2690d39be047f3028/crates/rspack_watcher/src/time.rs#L8-L50) · [Linux suite](https://github.com/web-infra-dev/rspack/actions/runs/45742405969/job/139651618189)

## Repeat the isolated test

In the PR checkout with its built binding and test dependencies, run the repository's compiler test runner.

```sh
pnpm --filter @rspack/tests test:base Compiler.test.mjs -t native-watcher-restored-missing-directory
```

The standalone verifier in this directory runs the PR's exact compiler case with a real Rspack watch compiler. It records the actual sets from its assertions. Each run starts a new process. The calibrated run first registers a real file with an mtime ending in 123 ms.

```sh
npm install --prefix . --no-save --package-lock=false --ignore-scripts @rspack/core@2.3.4
gh run download 45742405969 -R web-infra-dev/rspack -n bindings-x86_64-unknown-linux-gnu -D head
node verify.mjs
```

| Head process | Batches through the assertion about `marker` | Outcome |
| --- | --- | --- |
| Fresh | `[restored, src]`, `[marker, restored, src]` | Fails |
| After learning 10 ms precision | `[restored, src]`, `[marker]` | Passes, including the final mtime-change assertion |

The test was added in `b7c725c5ca805ea5a4e369c2690d39be047f3028`. Applying its assertion to the merge base gives the same fresh and calibrated outcomes. The regression is the new test's dependency on prior activity in the process. The previous PR version `ce42116` still fails after calibration, so the calibrated control also detects the duplicate notification that motivated the new test.

The verifier used Node.js 22.16.0 and the Linux x86-64 GNU binding from [run 45742405969](https://github.com/web-infra-dev/rspack/actions/runs/45742405969/job/139650536988), SHA-256 `5187c2e8ea7a8433774eb1017c517be38368106be73cfcfe7cd2e18ecd9ec30c`. The CI checkout was `947b81d11668eac3a9668c32404ad98465b74fef`, with parents `d04c7d790867e3c327fcc06b1f2d51585bd24ba1` and `b7c725c5ca805ea5a4e369c2690d39be047f3028`. The included test file matches Git blob `f358897a37bb411d95e2127104c9dfd20b2ce18e`.
