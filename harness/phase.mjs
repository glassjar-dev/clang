import { readFileSync, openSync, closeSync } from 'node:fs';
import { WASI } from 'node:wasi';
const [compiler, root, ...args] = process.argv.slice(2);
const module = await WebAssembly.compile(readFileSync(compiler));
const err = openSync('/dev/stderr', 'w');
for (let i = 0; i < 4; i++) {
  const last = i === 3;
  const wasi = new WASI({ version: 'preview1', args: ['clang', ...args, ...(last ? ['-ftime-report'] : [])], env: {}, preopens: { '/': root }, returnOnExit: true, stdout: err, stderr: last ? err : openSync('/dev/null', 'w') });
  wasi.start(await WebAssembly.instantiate(module, wasi.getImportObject()));
}
