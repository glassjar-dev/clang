// Times one compiler build on typical engine jobs, reusing one compiled Module (as the engine does).
//   node timing.mjs <llvm.core.wasm> [reps]
import { closeSync, openSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';
const here = dirname(fileURLToPath(import.meta.url));
const [compiler, reps = '7'] = process.argv.slice(2);
const sysroot = process.env.SYSROOT ?? resolve(here, '../../debugger.sh-coldstart/node_modules/.cache/cs106b-toolchain/sysroot');
const root = join(here, 'work', 'timing');
rmSync(root, { recursive: true, force: true }); mkdirSync(dirname(root), { recursive: true });
execFileSync('cp', ['-cR', sysroot, root]);
writeFileSync(join(root, 'empty.cpp'), 'int main() { return 0; }\n');
writeFileSync(join(root, 'hello.cpp'), '#include <iostream>\nint main() { std::cout << "hi\\n"; }\n');
writeFileSync(join(root, 'pre.h'), '#include <iostream>\n#include <vector>\n#include <string>\n#include <map>\n');
writeFileSync(join(root, 'stl.cpp'), readFileSync(join(here, 'corpus/stl.cpp')));
// The engine's preamble: the leading #include block of stl.cpp, precompiled.
const stl = readFileSync(join(here, 'corpus/stl.cpp'), 'utf8');
writeFileSync(join(root, 'stlpre.h'), stl.split('\n').filter((l) => l.startsWith('#include')).join('\n') + '\n');
const BASE = ['-cc1', '-triple', 'wasm32-wasip1', '-Werror', '-emit-obj', '-disable-free', '-isysroot', '/', '-internal-isystem', '/include/c++/v1',
  '-internal-isystem', '/include', '-internal-isystem', '/include/wasm32-wasip1', '-ferror-limit', '4', '-x', 'c++', '-std=c++23', '-fexceptions',
  '-fcxx-exceptions', '-exception-model=wasm', '-target-feature', '+exception-handling', '-mllvm', '-wasm-enable-eh', '-mllvm', '-wasm-use-legacy-eh=true'];
const cc = (src, extra = []) => ['clang', ...BASE, '-o', `/${src}.o`, ...extra, `/${src}`];
const pch = (out, extra = []) => ['clang', ...BASE.map((a) => (a === '-emit-obj' ? '-emit-pch' : a === 'c++' ? 'c++-header' : a)), '-o', out, ...extra, '-fvalidate-ast-input-files-content', '/stlpre.h'];
const usePch = (p, extra = []) => cc('stl.cpp', ['-include-pch', p, '-fvalidate-ast-input-files-content', ...extra]);
const G = ['-O0', '-debug-info-kind=standalone', '-dwarf-version=5'];
const only = process.env.ONLY;
const jobs = only === 'pch' ? {
  'build preamble pch': pch('/a.pch'),
  'build preamble pch +instantiate': pch('/b.pch', ['-fpch-instantiate-templates']),
  'STL-heavy with pch': usePch('/a.pch'),
  'STL-heavy with pch +instantiate': usePch('/b.pch'),
  'STL-heavy -g with pch': usePch('/a.pch', G),
  'STL-heavy -g with pch +instantiate': usePch('/b.pch', G),
} : {
  'clang -cc1 -version (startup only)': ['clang', '-cc1', '-version'],
  'wasm-ld --version (startup only)': ['wasm-ld', '--version'],
  'empty main': cc('empty.cpp'),
  'iostream hello': cc('hello.cpp'),
  'iostream hello -g': cc('hello.cpp', ['-O0', '-debug-info-kind=standalone', '-dwarf-version=5']),
  'STL-heavy': cc('stl.cpp'),
  'link hello': ['wasm-ld', '--export-dynamic', '-z', 'stack-size=1048576', '-L/lib/wasm32-wasip1', '/lib/wasm32-wasip1/crt1.o', '/hello.cpp.o',
    '/lib/wasm32-wasip1/cxa_exception.cpp.o', '/lib/wasm32-wasip1/cxa_personality.cpp.o', '-lc++', '-lc++abi', '-lunwind',
    '/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a', '-lc', '-o', '/hello.wasm'],
};
const module = await WebAssembly.compile(readFileSync(compiler));
const nul = openSync('/dev/null', 'w');
async function run(argv) {
  const wasi = new WASI({ version: 'preview1', args: argv, env: {}, preopens: { '/': root }, returnOnExit: true, stdout: nul, stderr: nul });
  const t0 = performance.now();
  const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
  const t1 = performance.now();
  const code = wasi.start(instance);
  return { inst: t1 - t0, total: performance.now() - t0, code };
}
// Warm up (lets V8 tier up the hot code, like a returning user's cached module).
for (let i = 0; i < 3; i++) for (const argv of Object.values(jobs)) await run(argv);
for (const [name, argv] of Object.entries(jobs)) {
  const times = [];
  let r;
  for (let i = 0; i < Number(reps); i++) { r = await run(argv); times.push(r); }
  const med = (k) => times.map((t) => t[k]).sort((a, b) => a - b)[times.length >> 1].toFixed(1);
  console.log(`${name.padEnd(36)} median ${med('total').padStart(7)}ms  (instantiate ${med('inst')}ms) exit=${r.code}`);
}
closeSync(nul);
