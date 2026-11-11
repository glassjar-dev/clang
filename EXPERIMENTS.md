# Experiments

What was tried while making `tiny` and `fast` (2026-11-10), including what did not pay off,
so nobody has to repeat it. Sizes are the final `.wasm`; "pre-opt" sizes are code bytes of
the linked module before wasm-opt, as `harness/sizes.py` reports them. Times are warm
compiles in Node 26 (V8) on an Apple M-series laptop from `harness/timing.mjs`; they drifted
by 10–15% over the day, so only ratios from back-to-back runs are meaningful.

## Starting point

`slim`: 45.1 MB, 15.8 MB gzip, 11.0 MB brotli. Code 36.7 MB in 56,273 functions, data
6.2 MB. Startup 4 ms, `iostream` hello ~420 ms, STL-heavy ~850 ms, link ~20 ms. The CPU
profile is flat (largest single function ~4%, `dlmalloc`), so speed had to come from how the
whole binary is built, not from one hot spot.

For comparison: browsercc's `clang.wasm` is 42.6 MB without a linker; YoWASP's module is
75.5 MB; seo-rii/wasm-llvm reports clang + wasm-ld at 52 MB as two modules. I found no
published -O0-only clang and no published PGO results for clang compiled to wasm.

## Size: what worked

Each step was checked with `harness/compare.mjs` against `slim` (0 differing jobs).

| Step | Size | brotli |
| --- | --- | --- |
| `slim` | 45.1 MB | 11.0 MB |
| Constant target and object format, -O0-only backend, cc1-only driver, no bitcode/LTO, constant-off language options, sanitizers off, frontend actions pruned | 32.5 MB | 8.1 MB |
| + never-built AST node kinds, constexpr interpreter off, `identify_magic` folded, profile and API-notes paths off, only -O0 passes registered | 28.2 MB | 7.3 MB |
| + `cc1_main.cpp` no longer includes `LinkAllPasses.h` | 26.1 MB | 6.8 MB |

Notes on individual pieces:

- **`Triple::getArch()` as a constant** is the highest-leverage single line: every
  architecture switch in clang, LLVM and lld folds.
- **Language options as a constant-zero proxy object** needed two fixes to compile: an
  explicit converting constructor (option marshalling `static_cast`s to the field's type)
  and a cast in the module-hash code.
- **`LinkAllPasses.h`** was found with `harness/who.py`: the optimizer passes had no
  callers except a static initializer in `cc1_main.cpp`. About 2 MB.
- **The legacy pass registry** (`initializeCodeGen`) keeps every registered pass alive.
  The kept list is the "Pass Arguments" line of `-mllvm -debug-pass=Structure` at -O0.

## Size: mistakes the checks caught

- **Guarding grouped `case` labels.** A first script put an "unreachable" guard after every
  case label naming a never-built kind. Where a live label falls through into a dead one
  (`case Live: case Dead: body`), the guard fired for the live kind and the compiler trapped
  on ordinary C++. The guard now goes only on groups where every label is dead and the
  preceding statement cannot fall in (272 sites instead of 792).
- **Pass dependencies.** Registering only the scheduled codegen passes missed analyses the
  full list registered as a side effect (`ProfileSummaryInfo` and others); instruction
  selection aborted. They are now registered explicitly.
- **A lazy Objective-C declaration in plain C++.** Clang's diagnostic formatter calls
  `getObjCProtocolDecl()` to compare types, which creates an `ObjCInterfaceDecl`. The
  construction trap caught it; the comparison is now skipped when Objective-C is off.
  This is the reason the trap exists: other such paths would show up the same way.

## Size: not done

- **Never-built `Type` kinds** (Objective-C object types, block pointers). Smaller gain,
  and more lazily-created cases like the one above are likely.
- **Per-target intrinsic names** (~0.5 MB of data): LLVM generates one table for all
  targets, and clang's builtin code references the enumerators.
- **Analyses the -O0 pipeline registers but never runs** (~1.4 MB pre-opt in
  `libLLVMAnalysis`), and **libc++ sort and locale instantiations** (~1.8 MB pre-opt).
  These are the next candidates.

## wasm-opt

On the 26.1 MB build, every level lands within about 1%:

| Flags | Size | brotli |
| --- | --- | --- |
| `-Os` (used) | 26.14 MB | 6.79 MB |
| `-Oz` | 25.81 MB | 6.76 MB |
| `-O3` | 26.21 MB | 6.78 MB |
| `-O4` | 26.24 MB | 6.81 MB |
| `-Os --converge` | 26.12 MB | 6.77 MB |
| `-O3 --low-memory-unused` | 26.07 MB | 6.73 MB |

`-O3` was not measurably faster than `-Os`. `--low-memory-unused` was not adopted: with
`--stack-first` the low addresses are the far end of the stack, and the gain is too small to
reason about that.

One trap: `wasm-opt` needs the module's `target_features` section, which `--strip-all`
removes. The scripts link unstripped and let wasm-opt drop the names.

## Speed: profile-guided optimization

wasi-sdk 32 ships no profile runtime. `build-profile-rt.sh` compiles compiler-rt's for
`wasm32-wasip1`; IR PGO (`-fprofile-generate`) then works under Node's WASI, one raw profile
per process. Three things were needed for the instrumented build: a stub `msync`, stubs for
two signal helpers that are normally optimized away, and writing the profile before
`_Exit` (wasm-ld leaves that way). The training run is the 154 harness jobs.

| Build | Size | brotli | STL-heavy vs `slim` |
| --- | --- | --- | --- |
| `tiny` (no profile) | 26.1 MB | 6.8 MB | 0.99× |
| `-O3` + profile | 40.2 MB | 9.0 MB | ~0.82–0.87× |
| `-O3` + profile, `-pgo-cold-func-opt=minsize` | 39.3 MB | 8.9 MB | ~0.85× |
| `-Os` + profile (`fast`) | 35.1 MB | 8.3 MB | ~0.77–0.84× |
| `-Os` + profile, `-hot-callsite-threshold=400` | 35.0 MB | 8.2 MB | same binary |

- **`-Os` with the profile beat `-O3` with it** on both size and speed.
- **Forcing cold functions to minimum size barely helped** `-O3`: the growth comes from
  `-O3` on warm code, not from cold code.
- **`-hot-callsite-threshold` had no effect**: the output was byte-for-byte the size of the
  build without it. Shrinking `fast` further needs a different lever.
- The first `fast` numbers used a profile from an `-O3` instrumented build (about 9,900
  stale-profile warnings). The shipped one records the profile at `-Os`, matching the final
  build; speed and size came out the same.
- With a precompiled header (the engine's steady state), measured on the first `-Os` +
  profile build: 370 → 308 ms, and 446 → 364 ms with `-g`.

## Not tried

- Wizer pre-initialization: startup is 3–4 ms, nothing to win.
- A faster allocator: `dlmalloc` is ~4–5% of a compile; wasi-libc offers no drop-in.
- `-msimd128` and wasi-libc's SIMD string functions: needs a custom wasi-libc.
- Binaryen `wasm-split` (load cold code lazily): needs loader support in the engine.
