// Cheap pre-flight: every module must parse before it is served.
// The app is unbundled, so a syntax error is otherwise discovered by the
// browser at module-evaluation time and can leave a page looking half-alive.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const roots = ['server', 'public/src', 'scripts', 'test'];
const bad = [];
const walk = dir => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) {
      const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
      if (r.status !== 0) bad.push(`${p}\n${(r.stderr || '').trim().split('\n').slice(0, 5).join('\n')}`);
    }
  }
};
for (const r of roots) {
  try { if (statSync(r).isDirectory()) walk(r); } catch {}
}
if (bad.length) {
  console.error(`refusing: ${bad.length} module(s) do not parse\n\n${bad.join('\n\n')}`);
  process.exit(1);
}
console.log('all modules parse');
