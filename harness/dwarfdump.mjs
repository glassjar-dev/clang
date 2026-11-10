import { readFileSync, openSync } from 'node:fs';
import { WASI } from 'node:wasi';
const [compiler, root, out, ...args] = process.argv.slice(2);
const fd = openSync(out, 'w');
const w = new WASI({ version: 'preview1', args: ['llvm-dwarfdump', ...args], env: {}, preopens: { '/': root }, returnOnExit: true, stdout: fd, stderr: fd });
w.start(await WebAssembly.instantiate(await WebAssembly.compile(readFileSync(compiler)), w.getImportObject()));
