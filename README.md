# glassjar clang

The C/C++ compiler that [glassjar](https://github.com/glassjar-dev/engine) runs in the browser:
one WebAssembly module (`llvm.core.wasm`) holding `clang -cc1`, `wasm-ld` and `llvm-ar`.

It is [YoWASP's clang](https://codeberg.org/YoWASP/clang) recipe at the same pinned LLVM
commit (`9560ae0`, LLVM 22.1.0), with three changes:

- **No LLVM assertions.** They slow every compile and add ~2,000 source paths and messages.
- **Only what the engine calls.** The other `llvm` driver tools are left out, and
  `patches/0001` builds `lld` with only its wasm linker.
- **Buffered output under WASI** (`patches/0002`). wasi-libc reports a block size of 0, which
  left LLVM's file streams unbuffered: writing one object file took ~48,000 host calls.

Compared with YoWASP's build: 72 MB → 43 MB (21.6 MB → 15.1 MB gzip), and warm compiles in
Chrome are 22–38% faster. Every object file, DWARF section, PCH and archive it produces is
byte-identical to YoWASP's build (checked by `harness/compare.mjs`).

## Build

Needs cmake, ninja, ccache and Binaryen `version_133`'s `wasm-opt` on `PATH` (clang's wasm
driver runs it after linking, so its version is part of the recipe).

```sh
git submodule update --init --depth 1 llvm-src wasi-libc-src
./build-glassjar.sh        # → dist/llvm.core.wasm
```

CI (`.github/workflows/build.yml`) builds the same thing on Linux with pinned, checksummed
wasi-sdk 32 and Binaryen 133.

## Check a build

```sh
node harness/compare.mjs <reference llvm.core.wasm> dist/llvm.core.wasm
```

runs both compilers over the engine's compile, debug (`-g`, DWARF 5), link, PCH, archive and
IntelliSense jobs and reports any output that differs by a byte. `harness/timing.mjs`,
`profile.mjs` and `syscalls.mjs` measure speed, hot functions and WASI calls.

The sysroot (`llvm-resources.tar.gz`) is unchanged from YoWASP's release.
