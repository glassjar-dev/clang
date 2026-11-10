// CPU-profiles compiles with a named compiler build; prints the top functions by self time.
//   node --cpu-prof --cpu-prof-dir=prof profile.mjs <named.wasm> ; then node profile.mjs --report prof/*.cpuprofile
import { readFileSync, openSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';
const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[2] === '--report') {
  const p = JSON.parse(readFileSync(process.argv[3]));
  const self = new Map(); let total = 0;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const dt = p.timeDeltas; const counts = new Map();
  p.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
  for (const [id, t] of counts) { const n = byId.get(id); const name = n.callFrame.functionName || '(anon)'; self.set(name, (self.get(name) ?? 0) + t); total += t; }
  const groups = new Map();
  const group = (n) => /malloc|free|realloc|calloc|memalign|dlmalloc|sbrk|tmalloc|morecore/.test(n) ? 'allocator' : /memcpy|memmove|memset|memcmp|strlen|strcmp/.test(n) ? 'mem/str ops' : /Hash|hash|DenseMap|StringMap|FoldingSet/.test(n) ? 'hashing/maps' : /Lexer|Preprocessor|Lex|Token/.test(n) ? 'lexing/preprocessor' : /Sema|Template|Deduc|Overload|Lookup/.test(n) ? 'sema/templates' : /ASTReader|ASTDeclReader|ASTStmtReader|Serialization|BitstreamCursor|ASTRecordReader/.test(n) ? 'pch reading' : /CodeGen|CGDebugInfo|IRBuilder|llvm::(Value|Instruction|BasicBlock|Function|Type|Constant|IR)/.test(n) ? 'IR codegen' : /SelectionDAG|FastISel|ISel|MachineInstr|MachineFunction|RegAlloc|AsmPrinter|MC|WebAssembly/.test(n) ? 'backend' : /^\(|wasi|node:|^$/.test(n) ? 'runtime/other' : 'other clang';
  for (const [name, t] of self) groups.set(group(name), (groups.get(group(name)) ?? 0) + t);
  console.log('by area:'); for (const [g, t] of [...groups].sort((a, b) => b[1] - a[1])) console.log(`  ${(100 * t / total).toFixed(1).padStart(5)}%  ${g}`);
  console.log('top functions (self):'); for (const [n, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${(100 * t / total).toFixed(1).padStart(5)}%  ${n.slice(0, 110)}`);
  process.exit(0);
}
const compiler = process.argv[2];
const sysroot = resolve(here, '../../debugger.sh-coldstart/node_modules/.cache/cs106b-toolchain/sysroot');
const root = join(here, 'work', 'profile'); rmSync(root, { recursive: true, force: true }); mkdirSync(dirname(root), { recursive: true });
execFileSync('cp', ['-cR', sysroot, root]);
writeFileSync(join(root, 'stl.cpp'), readFileSync(join(here, 'corpus/stl.cpp')));
const stl = readFileSync(join(here, 'corpus/stl.cpp'), 'utf8');
writeFileSync(join(root, 'pre.h'), stl.split('\n').filter((l) => l.startsWith('#include')).join('\n') + '\n');
const BASE = ['-cc1', '-triple', 'wasm32-wasip1', '-Werror', '-emit-obj', '-disable-free', '-isysroot', '/', '-internal-isystem', '/include/c++/v1', '-internal-isystem', '/include', '-internal-isystem', '/include/wasm32-wasip1', '-x', 'c++', '-std=c++23', '-fexceptions', '-fcxx-exceptions', '-exception-model=wasm', '-target-feature', '+exception-handling', '-mllvm', '-wasm-enable-eh', '-mllvm', '-wasm-use-legacy-eh=true'];
const module = await WebAssembly.compile(readFileSync(compiler));
const nul = openSync('/dev/null', 'w');
const run = async (args) => { const w = new WASI({ version: 'preview1', args: ['clang', ...args], env: {}, preopens: { '/': root }, returnOnExit: true, stdout: nul, stderr: nul }); return w.start(await WebAssembly.instantiate(module, w.getImportObject())); };
const pchArgs = BASE.map((a) => (a === '-emit-obj' ? '-emit-pch' : a === 'c++' ? 'c++-header' : a));
console.log('pch', await run([...pchArgs, '-o', '/pre.pch', '-fvalidate-ast-input-files-content', '/pre.h']));
// The engine's steady state: preamble PCH + student code, repeated (warm, tiered-up).
for (let i = 0; i < 12; i++) await run([...BASE, '-o', '/stl.o', '-include-pch', '/pre.pch', '-fvalidate-ast-input-files-content', '/stl.cpp']);
