# glassjar clang

The C/C++ compiler that [glassjar](https://github.com/glassjar-dev/engine) runs in the browser:
one WebAssembly module (`llvm.core.wasm`) holding `clang -cc1`, `wasm-ld` and `llvm-ar`.

It is [YoWASP's clang](https://codeberg.org/YoWASP/clang) recipe at the same pinned LLVM
commit (`9560ae0`, LLVM 22.1.0), built three ways:

| Variant | Size | gzip | brotli | STL-heavy compile | with PCH |
| --- | --- | --- | --- | --- | --- |
| YoWASP's build | 72 MB | 21.6 MB | | | |
| `slim` (released 2026-11-10) | 45.1 MB | 15.8 MB | 11.0 MB | 1.00× | 1.00× |
| `tiny` | 26.1 MB | 9.6 MB | 6.8 MB | 0.99× | 0.93× |
| `fast` | 35.1 MB | 12.5 MB | 8.3 MB | 0.81–0.84× | 0.83× |

Times are warm compiles in Node (V8), relative to `slim`, from back-to-back runs of
`harness/timing.mjs`. Every object file, DWARF section, PCH, archive and linked program
the three produce is byte-identical (`harness/compare.mjs`, 154 jobs).

## What each variant changes

**slim**

- **No LLVM assertions.** They slow every compile and add ~2,000 source paths and messages.
- **Only what the engine calls.** The other `llvm` driver tools are left out, and
  `patches/0001` builds `lld` with only its wasm linker.
- **Buffered output under WASI** (`patches/0002`). wasi-libc reports a block size of 0, which
  left LLVM's file streams unbuffered: writing one object file took ~48,000 host calls.

**tiny** adds `patches/0003`, which is inert unless the build defines `GLASSJAR_TINY` and
`GLASSJAR_O0_ONLY`. The patch removes almost no code itself. It tells the optimizer facts
about this toolchain, and link-time optimization then drops whatever those facts make
unreachable:

- **The target is always WebAssembly.** `Triple::getArch()` and `getObjectFormat()` return
  constants, so every switch over architectures or object formats keeps one arm: the other
  26 clang targets, their builtin tables, and the ELF/Mach-O/COFF paths go.
- **Only C and C++.** The Objective-C, OpenMP, OpenACC, OpenCL, HLSL, CUDA and SYCL language
  options read as a constant 0 (and ignore writes), so each `if (LangOpts.OpenMP)` folds.
- **AST node kinds those languages own are never built.** Constructing one traps; every
  dispatch on a node kind (`StmtVisitor`, `RecursiveASTVisitor`, `TreeTransform`,
  `DeclVisitor`, and the hand-written switches) marks those cases unreachable.
- **Only -O0.** `TargetMachine::getOptLevel()` is a constant, only the -O0 pass pipeline is
  built, only the passes it schedules are registered, and `cc1_main.cpp` no longer includes
  `LinkAllPasses.h` (a header that exists to force every pass to be linked).
  `-O1` and above are rejected with an error.
- **Only `clang -cc1`.** The engine writes its own cc1 command lines, so the gcc-style driver
  is not linked. `-cc1as` is gone too.
- **Only WebAssembly objects and archives are read.** `identify_magic()` folds every other
  format to "unknown"; no LLVM bitcode in or out, so no LTO in `wasm-ld`.
- **Never-enabled extras:** sanitizers, profile instrumentation, API notes, the experimental
  constexpr interpreter, ExtractAPI and the rewrite/fix-it frontend actions.

**fast** is tiny built with profile-guided optimization. wasi-sdk ships no profile runtime,
so `build-profile-rt.sh` builds compiler-rt's for `wasm32-wasip1`; `build-profile.sh` then
builds an instrumented compiler, runs it over the harness jobs, and merges the result into
`glassjar.profdata`. The final build stays at `-Os` and uses the profile to inline and lay
out the hot paths. (`-O3` with the same profile is 40 MB and no faster.)

## Build

Needs cmake, ninja, ccache and Binaryen `version_133`'s `wasm-opt` on `PATH` (its version is
part of the recipe).

```sh
git submodule update --init --depth 1 llvm-src wasi-libc-src
./build-glassjar.sh tiny   # → dist/llvm.core.wasm   (or: slim)

./build-profile.sh         # → glassjar.profdata (needs SYSROOT, see below)
./build-glassjar.sh fast
```

CI (`.github/workflows/build.yml`) builds `tiny` on Linux with pinned, checksummed
wasi-sdk 32 and Binaryen 133.

Both builds, and the profile `fast` was optimized with, are attached to the
[releases](https://github.com/glassjar-dev/clang/releases). glassjar ships `fast`.

## Check a build

```sh
node harness/compare.mjs <reference llvm.core.wasm> dist/llvm.core.wasm
```

runs both compilers over the engine's compile, debug (`-g`, DWARF 5), link, PCH, archive and
IntelliSense jobs and reports any output that differs by a byte. It needs a guest root with
the C++ sysroot and the Stanford sources (`SYSROOT`; the IDE's cs106b build leaves one in
`node_modules/.cache/cs106b-toolchain/sysroot`).

`harness/timing.mjs`, `profile.mjs` and `syscalls.mjs` measure speed, hot functions and WASI
calls. The linked module in the build directory keeps its function names (the last step,
wasm-opt, removes them), so you can ask where the size goes:

```sh
python3 harness/sizes.py build-tiny/bin/llvm 'OpenMP|OMP'   # how much code matches
python3 harness/who.py build-tiny/bin/llvm '^llvm::GVNPass::runImpl'   # what keeps it alive
```

[EXPERIMENTS.md](EXPERIMENTS.md) records what was tried on the way, including what did not
pay off.

The sysroot (`llvm-resources.tar.gz`) is unchanged from YoWASP's release.
