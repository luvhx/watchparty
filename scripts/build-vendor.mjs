// Bundle JASSUB (libass in wasm) into public/vendor/.
//
// JASSUB ships bare ESM imports in both its main module and its worker, so a
// browser cannot load it straight from node_modules without an import map.
// Bundling once is smaller and far less fragile. The wasm blobs and fallback
// font are copied verbatim; the renderer receives explicit URLs for them.
import { mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { build } from 'esbuild';

const OUT = 'public/vendor';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const jassub = 'node_modules/jassub/dist';
if (!existsSync(jassub)) {
  console.error('jassub is not installed. Run: npm install');
  process.exit(1);
}

await build({
  entryPoints: {
    jassub: `${jassub}/jassub.js`,
    'jassub-worker': `${jassub}/worker/worker.js`,
  },
  outdir: OUT,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  external: ['*.wasm'],
  logLevel: 'warning',
});

for (const f of ['wasm/jassub-worker.wasm', 'wasm/jassub-worker-modern.wasm', 'default.woff2']) {
  copyFileSync(`${jassub}/${f}`, `${OUT}/${f.split('/').pop()}`);
}

console.log(`vendor written to ${OUT}/`);
