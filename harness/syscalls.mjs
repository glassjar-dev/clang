// Counts and times the WASI calls one warm compile makes (preamble PCH + student code).
import { readFileSync, openSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';
const here = dirname(fileURLToPath(import.meta.url));
const [compiler, mode = 'preamble'] = process.argv.slice(2);
const root = join(here, 'work', 'sys'); rmSync(root, { recursive: true, force: true }); mkdirSync(dirname(root), { recursive: true });
execFileSync('cp', ['-cR', resolve(here, '../../debugger.sh-coldstart/node_modules/.cache/cs106b-toolchain/sysroot'), root]);
const stl = readFileSync(join(here, 'corpus/stl.cpp'), 'utf8');
writeFileSync(join(root, 'stl.cpp'), stl);
writeFileSync(join(root, 'pre.h'), stl.split('\n').filter((l) => l.startsWith('#include')).join('\n') + '\n');
writeFileSync(join(root, 'student.cpp'), '#include "vector.h"\n#include "SimpleTest.h"\nint main(){ Vector<int> v; v.add(1); return v.size(); }\n');
const BASE = ['-cc1', '-triple', 'wasm32-wasip1', '-Werror', '-emit-obj', '-disable-free', '-isysroot', '/', '-internal-isystem', '/include/c++/v1', '-internal-isystem', '/include', '-internal-isystem', '/include/wasm32-wasip1', '-x', 'c++', '-std=c++23', '-fexceptions', '-fcxx-exceptions', '-exception-model=wasm', '-target-feature', '+exception-handling', '-mllvm', '-wasm-enable-eh', '-mllvm', '-wasm-use-legacy-eh=true'];
const module = await WebAssembly.compile(readFileSync(compiler));
const nul = openSync('/dev/null', 'w');
async function run(args, count) {
  const w = new WASI({ version: 'preview1', args: ['clang', ...args], env: {}, preopens: { '/': root }, returnOnExit: true, stdout: nul, stderr: nul });
  const imports = w.getImportObject();
  const stats = {};
  if (count) for (const [k, f] of Object.entries(imports.wasi_snapshot_preview1)) imports.wasi_snapshot_preview1[k] = (...a) => { const t = performance.now(); const r = f(...a); const s = (stats[k] ??= { n: 0, ms: 0 }); s.n++; s.ms += performance.now() - t; return r; };
  const t = performance.now(); const code = w.start(await WebAssembly.instantiate(module, imports));
  return { code, ms: performance.now() - t, stats };
}
const pchArgs = BASE.map((a) => (a === '-emit-obj' ? '-emit-pch' : a === 'c++' ? 'c++-header' : a));
await run([...pchArgs, '-o', '/pre.pch', '-fvalidate-ast-input-files-content', '/pre.h']);
const jobs = {
  preamble: [...BASE, '-o', '/stl.o', '-include-pch', '/pre.pch', '-fvalidate-ast-input-files-content', '/stl.cpp'],
  'preamble, no validation': [...BASE, '-o', '/stl.o', '-include-pch', '/pre.pch', '-fno-validate-pch', '/stl.cpp'],
  stanford: [...BASE, '-o', '/s.o', '-include-pch', '/__cs106b/support.pch', '-fvalidate-ast-input-files-content', '/student.cpp'],
};
execFileSync('mkdir', ['-p', join(root, '__cs106b')]); execFileSync('cp', [resolve(here, '../../debugger.sh-coldstart/public/cs106b/support.pch'), join(root, '__cs106b/support.pch')]);
for (const [name, args] of Object.entries(jobs)) {
  for (let i = 0; i < 4; i++) await run(args, false);
  const { code, ms, stats } = await run(args, true);
  const total = Object.values(stats).reduce((a, s) => a + s.ms, 0);
  console.log(`${name}: exit ${code}, ${ms.toFixed(0)}ms total, ${total.toFixed(0)}ms in ${Object.values(stats).reduce((a, s) => a + s.n, 0)} WASI calls`);
  for (const [k, s] of Object.entries(stats).sort((a, b) => b[1].ms - a[1].ms).slice(0, 6)) console.log(`   ${k.padEnd(20)} ${String(s.n).padStart(6)} calls ${s.ms.toFixed(1).padStart(7)}ms`);
}
