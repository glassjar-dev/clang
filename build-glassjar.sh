#!/bin/sh -e
# Builds glassjar's in-browser compiler (dist/llvm.core.wasm): YoWASP's clang recipe at
# its pinned LLVM commit, minus LLVM's internal assertions and the tools the engine never
# calls, plus the patches in patches/. Only the llvm driver is built; the sysroot
# (llvm-resources.tar.gz) is unchanged and still comes from the earlier release.
#
# clang's wasm driver runs Binaryen's wasm-opt after linking whenever it is on PATH,
# so the exact Binaryen version is part of the recipe.
cd "$(dirname "$0")"
BINARYEN_VERSION=133
if ! wasm-opt --version 2>/dev/null | grep -q "version ${BINARYEN_VERSION}\b"; then
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

export BUILD_DIR="${BUILD_DIR:-build-glassjar}"
CMAKE_GENERATOR=Ninja EXTRA_CMAKE="${FLAGS}" ./build-variant.sh

mkdir -p dist
cp "${BUILD_DIR}/bin/llvm" dist/llvm.core.wasm
shasum -a 256 dist/llvm.core.wasm | tee dist/llvm.core.wasm.sha256
