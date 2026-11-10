// Does a preamble PCH built WITHOUT debug info give the same -g object as no PCH at all?
import { readFileSync, openSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { WASI } from 'node:wasi';
const here = dirname(fileURLToPath(import.meta.url));
const [compiler] = process.argv.slice(2);
const root = join(here, 'work', 'dbgpch'); rmSync(root, { recursive: true, force: true }); mkdirSync(dirname(root), { recursive: true });
execFileSync('cp', ['-cR', resolve(here, '../../debugger.sh-coldstart/node_modules/.cache/cs106b-toolchain/sysroot'), root]);
const BASE = ['-cc1', '-triple', 'wasm32-wasip1', '-Werror', '-emit-obj', '-disable-free', '-isysroot', '/', '-internal-isystem', '/include/c++/v1', '-internal-isystem', '/include', '-internal-isystem', '/include/wasm32-wasip1', '-ferror-limit', '4', '-fcolor-diagnostics', '-x', 'c++', '-std=c++23', '-fexceptions', '-fcxx-exceptions', '-exception-model=wasm', '-target-feature', '+exception-handling', '-mllvm', '-wasm-enable-eh', '-mllvm', '-wasm-use-legacy-eh=true'];
const G = ['-O0', '-debug-info-kind=standalone', '-dwarf-version=5'];
const module = await WebAssembly.compile(readFileSync(compiler));
const err = openSync(join(root, 'err.txt'), 'w');
const run = async (args) => { const w = new WASI({ version: 'preview1', args: ['clang', ...args], env: {}, preopens: { '/': root }, returnOnExit: true, stdout: err, stderr: err }); const t = performance.now(); const c = w.start(await WebAssembly.instantiate(module, w.getImportObject())); return { c, ms: performance.now() - t }; };
const sha = (p) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex').slice(0, 12);
const files = [join(here, 'corpus/stl.cpp'), join(here, 'corpus/exceptions.cpp'), join(here, 'corpus/c_style.cpp'), ...['basic', 'basic-struct', 'formatting/map', 'formatting/deque', 'memory', 'exceptions', 'step-in'].map((d) => resolve(here, '../../engine/tools/dap/tests', d, 'main.cpp'))];
let same = 0;
for (const [i, f] of files.entries()) {
  const src = readFileSync(f, 'utf8');
  // The engine's preamble: the leading run of #include <...> lines.
  const lines = src.split('\n'); let n = 0; while (n < lines.length && /^\s*(#include\s*<[^>]+>\s*)?$/.test(lines[n])) n++;
  const pre = lines.slice(0, n).filter((l) => l.trim()).join('\n') + '\n';
  writeFileSync(join(root, `p${i}.h`), pre); writeFileSync(join(root, `m${i}.cpp`), src);
  const pch = BASE.map((a) => (a === '-emit-obj' ? '-emit-pch' : a === 'c++' ? 'c++-header' : a));
  const b = await run([...pch, '-o', `/p${i}.pch`, '-fvalidate-ast-input-files-content', `/p${i}.h`]);
  const plain = await run([...BASE, '-o', `/a${i}.o`, ...G, `/m${i}.cpp`]);
  const withPch = await run([...BASE, '-o', `/b${i}.o`, ...G, '-include-pch', `/p${i}.pch`, '-fvalidate-ast-input-files-content', `/m${i}.cpp`]);
  const eq = sha(`a${i}.o`) === sha(`b${i}.o`); same += eq;
  console.log(`${basename(dirname(f))}/${basename(f)}: pch build ${b.ms.toFixed(0)}ms(exit ${b.c}), -g plain ${plain.ms.toFixed(0)}ms, -g with pch ${withPch.ms.toFixed(0)}ms(exit ${withPch.c}) -> ${eq ? 'IDENTICAL' : 'differs'}`);
}
console.log(`${same}/${files.length} identical`);
