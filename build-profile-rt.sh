#!/bin/sh -e
# Builds compiler-rt's profile runtime (libclang_rt.profile.a) for wasm32-wasip1 and puts
# it where wasi-sdk's clang looks for it. wasi-sdk does not ship this library, and
# -fprofile-generate (the first half of a PGO build) cannot link without it.
cd "$(dirname "$0")"
SDK="${1:?usage: build-profile-rt.sh <wasi-sdk dir>}"
SRC=llvm-src/compiler-rt/lib/profile
OUT="${SDK}/lib/clang/22/lib/wasm32-unknown-wasip1"
TMP=$(mktemp -d)
for f in InstrProfiling InstrProfilingInternal InstrProfilingBuffer InstrProfilingMerge \
  InstrProfilingMergeFile InstrProfilingNameVar InstrProfilingVersionVar InstrProfilingWriter \
  InstrProfilingPlatformLinux InstrProfilingPlatformOther InstrProfilingFile InstrProfilingUtil \
  InstrProfilingValue; do
  "${SDK}/bin/clang" --target=wasm32-wasip1 --sysroot "${SDK}/share/wasi-sysroot" -mcpu=lime1 \
    -O2 -I"${SRC}/.." -I"${SRC}/../../include" -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_GETPID \
    -DCOMPILER_RT_HAS_UNAME=0 -Wno-pedantic -c "${SRC}/${f}.c" -o "${TMP}/${f}.o"
done
"${SDK}/bin/clang++" --target=wasm32-wasip1 --sysroot "${SDK}/share/wasi-sysroot" -mcpu=lime1 \
  -O2 -fno-exceptions -fno-rtti -I"${SRC}/.." -I"${SRC}/../../include" \
  -c "${SRC}/InstrProfilingRuntime.cpp" -o "${TMP}/InstrProfilingRuntime.o"
# wasi-libc's emulated mman has no msync; the runtime only calls it after writing through a
# mapping, which this target never sets up.
printf 'int msync(void *a, unsigned long n, int f) { (void)a; (void)n; (void)f; return 0; }\n' >"${TMP}/msync.c"
"${SDK}/bin/clang" --target=wasm32-wasip1 --sysroot "${SDK}/share/wasi-sysroot" -mcpu=lime1 -O2 \
  -c "${TMP}/msync.c" -o "${TMP}/msync.o"
rm -f "${OUT}/libclang_rt.profile.a"
"${SDK}/bin/llvm-ar" rcs "${OUT}/libclang_rt.profile.a" "${TMP}"/*.o
rm -rf "${TMP}"
echo "wrote ${OUT}/libclang_rt.profile.a"
