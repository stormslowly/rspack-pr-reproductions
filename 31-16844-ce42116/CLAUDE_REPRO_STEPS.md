# The watcher regression test fails to compile under workspace Clippy

The new test compares `Path::new(&path).parent()` with `Some(&moved)`. The left operand is `Option<&Path>`. With the workspace's `rkyv 0.7.45` comparison implementations in scope, the compiler infers `Option<&PathBuf>` on the right and reports E0277. The narrower watcher test job compiles the same source. Passing `moved.as_path()` makes the right operand's type explicit. [Changed comparison](https://github.com/web-infra-dev/rspack/blob/ce42116c0b495162588a6ce8778f1768887c2e1a/crates/rspack_watcher_testing/tests/scan_observations.rs#L169-L176)

| Original CI invocation | Source checked out | Result |
| --- | --- | --- |
| [Workspace Clippy, merge base](https://github.com/web-infra-dev/rspack/actions/runs/45339599429/job/138259972599) | `84a03cf37a4bb6f7afa8621f8fe103be32ee1ac3` | Passed |
| [Workspace Clippy, previous PR revision](https://github.com/web-infra-dev/rspack/actions/runs/45666007666/job/139388534603) | `0114306f1e8419d80cd61301f6e4910d23eef10b` (PR head `f5cd1d2`) | Passed |
| [Workspace Clippy, reviewed PR](https://github.com/web-infra-dev/rspack/actions/runs/45679201684/job/139435168486) | `0c620ff0c7acd7e8739e24f7fc8dbfbfec6b7cb1` | E0277 at `scan_observations.rs:173` |
| [Watcher crate tests, reviewed PR](https://github.com/web-infra-dev/rspack/actions/runs/45679201684/job/139435168532) | `0c620ff0c7acd7e8739e24f7fc8dbfbfec6b7cb1` | Passed, including the new test |

The reviewed CI checkout has first parent `f9a8ef34466814e5eae706892701f6c933bd4fe0` and second parent `ce42116c0b495162588a6ce8778f1768887c2e1a`. The test file matches the reviewed head. Run the original CI check from an Rspack checkout.

```sh
cargo clippy --workspace --all-targets --tests --locked -- -D warnings
```

## Run the reduced compiler case

With Node.js and rustup available, run these commands from this case directory.

```sh
rustup toolchain install nightly-2026-11-13 --profile minimal
node verify.mjs
```

The verifier compiles the original comparison in a temporary Cargo project, first on its own and then with the exact `rkyv` version named by the CI diagnostic. A third compilation keeps that dependency and uses `Some(moved.as_path())`. The three observed results on Linux were `pass`, `E0277`, and `pass`. The compiler was `rustc 1.102.0-nightly (8eb778d04 2026-11-12)`.
