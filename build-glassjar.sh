#!/bin/sh -e
# Builds glassjar's in-browser compiler (dist/llvm.core.wasm): YoWASP's clang recipe at its
# pinned LLVM commit plus the patches in patches/. Only the llvm driver is built; the sysroot
# (llvm-resources.tar.gz) is unchanged and still comes from the earlier release.
#
#   ./build-glassjar.sh [slim|tiny|fast]
#
#   slim  the 2026-11-10 release: no assertions, only clang/wasm-ld/llvm-ar (45 MB).
#   tiny  slim, plus everything a C/C++-to-WebAssembly, -O0-only, `clang -cc1`-only
#         compiler can never run is left out (26 MB). The default.
#   fast  tiny, optimized with the execution profile in glassjar.profdata, which
#         ./build-profile.sh records (35 MB, about 18% faster).
#
# All three produce byte-identical objects, PCHs, archives and linked programs
# (harness/compare.mjs).
#
# wasm-opt's exact version is part of the recipe: slim lets clang's wasm driver run it at
# link time (it does so whenever it is on PATH); tiny and fast run it as their last step.
cd "$(dirname "$0")"
VARIANT="${1:-tiny}"
BINARYEN_VERSION=133
if ! wasm-opt --version 2>/dev/null | grep -qE "version ${BINARYEN_VERSION}( |$)"; then
  echo "Put Binaryen version_${BINARYEN_VERSION}'s wasm-opt on PATH first." >&2
  exit 1
fi

for patch in patches/*.patch; do
  if git -C llvm-src apply --reverse --check "../${patch}" 2>/dev/null; then
    echo "already applied: ${patch}"
  else
    git -C llvm-src apply "../${patch}"
  fi
done

FLAGS="-DLLVM_ENABLE_ASSERTIONS=OFF -DLLD_WASM_ONLY=ON"
for tool in NM OBJCOPY OBJDUMP READOBJ SIZE SYMBOLIZER CXXFILT DWARFDUMP; do
  FLAGS="${FLAGS} -DLLVM_TOOL_LLVM_${tool}_BUILD=OFF"
done

case "${VARIANT}" in
  slim) ;;
  tiny | fast | profile)
    # GLASSJAR_TINY and GLASSJAR_O0_ONLY turn on patches/0003 (see the README).
    EXTRA_CFLAGS="-DGLASSJAR_TINY -DGLASSJAR_O0_ONLY"
    # Linked with its names and feature list; the wasm-opt step below needs the feature list
    # and removes the names, so ${BUILD_DIR}/bin/llvm stays readable by harness/sizes.py.
    EXTRA_LDFLAGS="--no-wasm-opt"
    LINK_STRIP=""
    FLAGS="${FLAGS} -DLLVM_TOOL_LLVM_CGDATA_BUILD=OFF -DLLVM_ENABLE_BACKTRACES=OFF"
    FLAGS="${FLAGS} -DLLVM_ENABLE_CRASH_OVERRIDES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF"
    FLAGS="${FLAGS} -DLLVM_ENABLE_TELEMETRY=OFF -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF"
    FLAGS="${FLAGS} -DLLVM_ENABLE_LIBXML2=OFF"
    ;;
  *) echo "usage: $0 [slim|tiny|fast]" >&2; exit 1 ;;
esac
case "${VARIANT}" in
  fast)
    [ -f glassjar.profdata ] || { echo "No glassjar.profdata: run ./build-profile.sh first." >&2; exit 1; }
    EXTRA_CFLAGS="${EXTRA_CFLAGS} -fprofile-use=$(pwd)/glassjar.profdata"
    EXTRA_CFLAGS="${EXTRA_CFLAGS} -Wno-profile-instr-unprofiled -Wno-profile-instr-out-of-date"
    ;;
  profile)
    # Internal: the instrumented compiler build-profile.sh runs to record the profile.
    EXTRA_CFLAGS="${EXTRA_CFLAGS} -DGLASSJAR_PGO_GEN -fprofile-generate"
    EXTRA_LDFLAGS="${EXTRA_LDFLAGS} -lwasi-emulated-getpid"
    ;;
esac

export BUILD_DIR="${BUILD_DIR:-build-${VARIANT}}" EXTRA_CFLAGS EXTRA_LDFLAGS
[ "${VARIANT}" = slim ] || export LINK_STRIP
CMAKE_GENERATOR=Ninja EXTRA_CMAKE="${FLAGS}" ./build-variant.sh

[ "${VARIANT}" = profile ] && exit 0
OUT="${OUT:-dist/llvm.core.wasm}"
mkdir -p "$(dirname "${OUT}")"
if [ "${VARIANT}" = slim ]; then
  cp "${BUILD_DIR}/bin/llvm" "${OUT}"
else
  wasm-opt -Os --strip-debug --strip-producers "${BUILD_DIR}/bin/llvm" -o "${OUT}"
fi
shasum -a 256 "${OUT}" | tee "${OUT}.sha256"
