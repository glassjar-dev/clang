// Runs two builds of llvm.core.wasm over the same jobs (the engine's compile, debug,
// link, PCH and archive steps, IntelliSense queries, and failing programs) and reports
// any output that differs by even one byte.
//
//   node compare.mjs <reference.wasm> <candidate.wasm> [--keep]
//
// SYSROOT must point at a guest root holding the C++ sysroot, the exceptions runtime and
// the Stanford sources (the IDE's cs106b build leaves one in
// node_modules/.cache/cs106b-toolchain/sysroot).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';

const here = dirname(fileURLToPath(import.meta.url));
const [referencePath, candidatePath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const keep = process.argv.includes('--keep');
const sysroot = process.env.SYSROOT ?? resolve(here, '../../debugger.sh-coldstart/node_modules/.cache/cs106b-toolchain/sysroot');
const dapTests = process.env.DAP_TESTS ?? resolve(here, '../../engine/tools/dap/tests');
const work = resolve(here, 'work');
if (!referencePath || !candidatePath) throw new Error('usage: node compare.mjs <reference.wasm> <candidate.wasm>');
if (!existsSync(join(sysroot, 'include/c++/v1'))) throw new Error(`No sysroot at ${sysroot}`);

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The engine's flags (src/worker/mod.rs cpp_clang_args / cpp_link_args).
const BASE = ['-cc1', '-triple', 'wasm32-wasip1', '-Werror', '-disable-free', '-isysroot', '/',
  '-internal-isystem', '/include/c++/v1', '-internal-isystem', '/include', '-internal-isystem', '/include/wasm32-wasip1'];
const EH = ['-fexceptions', '-fcxx-exceptions', '-exception-model=wasm', '-target-feature', '+exception-handling',
  '-mllvm', '-wasm-enable-eh', '-mllvm', '-wasm-use-legacy-eh=true'];
const ENGINE = [...BASE.slice(0, 4), '-emit-obj', ...BASE.slice(4), '-ferror-limit', '4', '-fcolor-diagnostics', '-x', 'c++', '-std=c++23', ...EH];
const DEBUG = ['-O0', '-debug-info-kind=standalone', '-dwarf-version=5'];
const STANFORD = [...BASE, '-std=c++23', ...EH]; // cs106b/scripts/build-precompiled.mjs
const compile = (src, out, { debug = false, pch, extra = [] } = {}) => ['clang', ...ENGINE, '-o', out, ...(debug ? DEBUG : []),
  ...(pch ? ['-include-pch', pch, '-fvalidate-ast-input-files-content'] : []), ...extra, src];
const link = (objects, out, archives = []) => ['wasm-ld', '--export-dynamic', '-z', 'stack-size=1048576', '-L/lib/wasm32-wasip1',
  '/lib/wasm32-wasip1/crt1.o', ...objects, ...archives, '/lib/wasm32-wasip1/cxa_exception.cpp.o', '/lib/wasm32-wasip1/cxa_personality.cpp.o',
  '-lc++', '-lc++abi', '-lunwind', '/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a', '-lc', '-o', out];
const INTELLISENSE = ['clang', ...BASE.slice(0, 4), '-fsyntax-only', ...BASE.slice(4), '-x', 'c++', '-std=c++23', ...EH.slice(0, 5),
  '-include-pch', '/out/support.pch', '-fno-validate-pch'];

// Jobs: argv plus the guest files they produce. Every job runs in order in both roots.
const jobs = [];
const job = (name, argv, outputs = []) => jobs.push({ name, argv, outputs });

// Test programs: our corpus plus the debugger's fixtures, each built the run way and the debug way.
const programs = [];
for (const file of readdirSync(join(here, 'corpus')).sort()) programs.push({ name: basename(file, '.cpp'), files: [join(here, 'corpus', file)] });
const walk = (dir) => readdirSync(dir).flatMap((e) => (statSync(join(dir, e)).isDirectory() ? walk(join(dir, e)) : [join(dir, e)]));
const byDir = new Map();
for (const file of walk(dapTests).filter((f) => f.endsWith('.cpp')).sort()) {
  const key = 'dap-' + dirname(file).slice(dapTests.length + 1).replaceAll('/', '-');
  byDir.set(key, [...(byDir.get(key) ?? []), file]);
}
for (const [name, files] of byDir) programs.push({ name, files });

for (const { name, files } of programs) {
  const sources = files.map((f) => `/t/${name}/${basename(f)}`);
  for (const mode of ['run', 'debug']) {
    const objects = sources.map((s) => `${s}.${mode}.o`);
    sources.forEach((s, i) => job(`${name}: compile ${mode} ${basename(s)}`, compile(s, objects[i], { debug: mode === 'debug' }), [objects[i]]));
    if (!name.startsWith('err_')) job(`${name}: link ${mode}`, link(objects, `/out/${name}.${mode}.wasm`), [`/out/${name}.${mode}.wasm`]);
  }
}

// The engine's per-worker preamble PCH for a program's leading #include block.
job('preamble: emit pch', ['clang', ...ENGINE.map((a) => (a === '-emit-obj' ? '-emit-pch' : a === 'c++' ? 'c++-header' : a)), '-o', '/out/preamble.pch',
  // The engine omits -fno-pch-timestamp; it is here only so two runs can match byte for byte.
  '-fno-pch-timestamp', '-fvalidate-ast-input-files-content', '/t/preamble.h'], ['/out/preamble.pch']);
job('preamble: compile with pch', compile('/t/stl/stl.cpp', '/out/stl.preamble.o', { pch: '/out/preamble.pch' }), ['/out/stl.preamble.o']);

// Stanford: the PCH and the two archives exactly as the IDE builds them, then a student program.
job('stanford: support.pch', ['clang', ...STANFORD, '-emit-pch', '-fno-pch-timestamp', '-fvalidate-ast-input-files-content', '-x', 'c++-header',
  '-o', '/out/support.pch', '/cs106b-prelude.h'], ['/out/support.pch']);
const supportSources = readdirSync(sysroot).filter((f) => f.startsWith('support_') && f.endsWith('.cpp')).sort();
for (const mode of ['run', 'debug']) {
  // Same object and archive names as the IDE's build, so the archives match its files.
  const objects = supportSources.map((s) => `/${s}.o`);
  supportSources.forEach((s, i) => job(`stanford: ${mode} ${s}`, ['clang', ...STANFORD, ...(mode === 'debug' ? DEBUG : []), '-emit-obj', '-x', 'c++', '-o', objects[i], '/' + s], [objects[i]]));
  job(`stanford: ${mode}.a`, ['llvm-ar', 'rcs', `/${mode}.a`, ...objects], [`/${mode}.a`]);
  job(`stanford: student ${mode}`, compile('/student.cpp', `/out/student.${mode}.o`, { debug: mode === 'debug', pch: '/out/support.pch' }), [`/out/student.${mode}.o`]);
  job(`stanford: link student ${mode}`, link([`/out/student.${mode}.o`], `/out/student.${mode}.wasm`, [`/${mode}.a`]), [`/out/student.${mode}.wasm`]);
}

// IntelliSense (the IDE's clangService): diagnostics, completion and AST queries.
job('intellisense: syntax', [...INTELLISENSE, '-ferror-limit', '30', '-fdiagnostics-print-source-range-info', '-fdiagnostics-parseable-fixits', '/student.cpp']);
job('intellisense: syntax error', [...INTELLISENSE, '-ferror-limit', '30', '-fdiagnostics-parseable-fixits', '/t/err_syntax/err_syntax.cpp']);
job('intellisense: member completion', [...INTELLISENSE, '-code-completion-at=/student.cpp:10:9', '-code-completion-brief-comments', '/student.cpp']);
job('intellisense: global completion', [...INTELLISENSE, '-code-completion-at=/student.cpp:9:3', '-code-completion-brief-comments', '-code-completion-macros',
  '-code-completion-patterns', '/student.cpp']);
job('intellisense: ast dump', [...INTELLISENSE, '-ast-dump=json', '-ast-dump-filter=words', '/student.cpp']);

const STUDENT = `#include <iostream>
#include "vector.h"
#include "SimpleTest.h"
using namespace std;
PROVIDED_TEST("Vector basic ops") { Vector<int> v; v.add(1); EXPECT_EQUAL(v.size(), 1); }
int main() {
  Vector<string> words;
  words.add("hello");
  words.size();
  words.
  cout << words << endl;
  return 0;
}
`;

async function runAll(compilerPath, root) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(dirname(root), { recursive: true });
  execFileSync('cp', ['-cR', sysroot, root]); // APFS clone: instant
  mkdirSync(join(root, 'out'), { recursive: true });
  for (const { name, files } of programs) {
    mkdirSync(join(root, 't', name), { recursive: true });
    for (const f of files) copyFileSync(f, join(root, 't', name, basename(f)));
  }
  writeFileSync(join(root, 't/preamble.h'), '#include <algorithm>\n#include <iostream>\n#include <map>\n#include <vector>\n');
  // Valid program for linking; the IntelliSense queries point at its line 10 ("words.").
  writeFileSync(join(root, 'student.cpp'), STUDENT.replace('  words.\n', '  // words.\n'));
  const module = await WebAssembly.compile(readFileSync(compilerPath));
  const results = [];
  let ms = 0;
  for (const { name, argv, outputs } of jobs) {
    // Completion runs on half-typed code ("words."); everything else on the finished program.
    writeFileSync(join(root, 'student.cpp'), name.includes('completion') ? STUDENT : STUDENT.replace('  words.\n', '  // words.\n'));
    const out = join(root, 'stdout'), err = join(root, 'stderr');
    const stdout = openSync(out, 'w'), stderr = openSync(err, 'w');
    const wasi = new WASI({ version: 'preview1', args: argv, env: {}, preopens: { '/': root }, returnOnExit: true, stdout, stderr });
    const started = performance.now();
    const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
    let code;
    try { code = wasi.start(instance); } catch (error) { code = `trap: ${error.message}`; }
    ms += performance.now() - started;
    closeSync(stdout); closeSync(stderr);
    const files = Object.fromEntries(outputs.map((o) => [o, existsSync(join(root, o)) ? sha(readFileSync(join(root, o))) : 'missing']));
    results.push({ name, code, stdout: readFileSync(out), stderr: readFileSync(err), files });
    if (keep) writeFileSync(join(root, 'out', name.replace(/[^a-z0-9]+/gi, '_') + '.stdout'), readFileSync(out));
  }
  return { results, ms };
}

const reference = await runAll(referencePath, join(work, 'reference'));
const candidate = await runAll(candidatePath, join(work, 'candidate'));
let differences = 0;
const failures = [];
for (let i = 0; i < jobs.length; i++) {
  const a = reference.results[i], b = candidate.results[i];
  const diffs = [];
  if (a.code !== b.code) diffs.push(`exit ${a.code} vs ${b.code}`);
  // clang prints AST node addresses and orders equal-ranked completions by address, so
  // those two outputs are compared with addresses masked and lines sorted.
  const normal = (buf) => {
    let text = buf.toString().replace(/0x[0-9a-f]+/g, 'PTR');
    if (jobs[i].name.includes('completion')) text = text.split('\n').sort().join('\n');
    return sha(text);
  };
  if (normal(a.stdout) !== normal(b.stdout)) diffs.push(`stdout (${a.stdout.length} vs ${b.stdout.length} bytes)`);
  if (sha(a.stderr) !== sha(b.stderr)) diffs.push(`stderr (${a.stderr.length} vs ${b.stderr.length} bytes)`);
  for (const file of Object.keys(a.files)) if (a.files[file] !== b.files[file]) diffs.push(`${file} differs`);
  if (a.code !== 0 && !jobs[i].name.startsWith('err_') && !jobs[i].name.includes('error')) failures.push(`${jobs[i].name}: exit ${a.code} ${a.stderr.toString().slice(0, 200)}`);
  if (diffs.length) { differences++; console.log(`DIFF  ${jobs[i].name}: ${diffs.join(', ')}`); }
}
const outputs = jobs.reduce((n, j) => n + j.outputs.length, 0);
console.log(`${jobs.length} jobs, ${outputs} output files, ${differences} differing jobs`);
console.log(`time: reference ${(reference.ms / 1000).toFixed(1)}s, candidate ${(candidate.ms / 1000).toFixed(1)}s`);
if (failures.length) console.log(`jobs that failed in the reference too (check the harness):\n  ${failures.join('\n  ')}`);
if (!keep) rmSync(work, { recursive: true, force: true });
process.exit(differences ? 1 : 0);
