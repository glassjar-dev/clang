#!/bin/sh -e
# Records the execution profile that `./build-glassjar.sh fast` optimizes with:
# builds an instrumented compiler, runs it over the harness jobs (the engine's compile,
# debug, link, PCH, archive and IntelliSense steps), and merges what it wrote into
# glassjar.profdata. Needs the same SYSROOT as harness/compare.mjs.
cd "$(dirname "$0")"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) WASI_HOST=arm64-macos ;;
  Darwin-x86_64) WASI_HOST=x86_64-macos ;;
  Linux-x86_64) WASI_HOST=x86_64-linux ;;
  Linux-aarch64) WASI_HOST=arm64-linux ;;
esac
SDK="wasi-sdk-32.0-${WASI_HOST}"

# wasi-sdk ships no profile runtime, and the merge tool has to match this LLVM.
[ -d "${SDK}" ] || { echo "Run ./build-glassjar.sh once first (it downloads ${SDK})." >&2; exit 1; }
./build-profile-rt.sh "${SDK}"
cmake --build llvm-tblgen-build --target llvm-profdata

./build-glassjar.sh profile
rm -rf profraw
PROFILE_DIR=profraw node harness/compare.mjs build-profile/bin/llvm build-profile/bin/llvm
llvm-tblgen-build/bin/llvm-profdata merge -o glassjar.profdata profraw/*.profraw
rm -rf profraw
ls -l glassjar.profdata
