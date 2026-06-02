// Valide la STABILITÉ du placement (brique G) : à chaque nouveau spawn, les nodes EXISTANTS ne
// bougent PAS (pas de re-calcul global -> pas de clignotement). Le nouveau node est posé dans un
// trou libre (pas de chevauchement). Prérequis : serveur sur le repo de test, _g_serve.py <repo> 8799.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.pw');
mkdirSync(OUT, { recursive: true });
const logs = [];
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: 1440, height: 860 });
p.on('console', (m) => { if (m.type() === 'error') logs.push('[console] ' + m.text()); });
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
const out = {};

const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }); await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 }); await p.waitForTimeout(900); };
const open = (f) => p.evaluate(async (path) => { let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.openFileInNewEditor) d = x; } await d.openFileInNewEditor(path); }, f);
const snapshot = () => p.evaluate(() => { const m = {}; document.querySelectorAll('.node-wrap').forEach((w) => { m[w.dataset.id] = { x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0, kind: w.dataset.kind, folder: w.dataset.folder || '', file: w.dataset.file || '' }; }); return m; });
const overlaps = () => p.evaluate(() => { const sub = [...document.querySelectorAll('.node-wrap[data-kind="folder"], .node-wrap[data-kind="fileeditor"]')]; const bx = sub.map((w) => ({ x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0, w: w.offsetWidth, h: w.offsetHeight })); let o = 0; for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) { const A = bx[i], B = bx[j]; if (A.x < B.x + B.w - 2 && B.x < A.x + A.w - 2 && A.y < B.y + B.h - 2 && B.y < A.y + A.h - 2) o++; } return o; });

try {
  await boot();
  await p.evaluate(async () => { const bs = new Set(['kernel', 'gitbranch', 'fileexplorer', 'chat']); for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!bs.has(n.kind)) await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); });
  await boot();

  // construit un peu de structure
  await open('src/a/x.py'); await p.waitForTimeout(500);
  await open('src/a/z.py'); await p.waitForTimeout(500);
  await open('docs/superpowers/specs/foo.md'); await p.waitForTimeout(700);
  const before = await snapshot();

  // NOUVEAU spawn -> les nodes existants ne doivent PAS bouger
  await open('docs/superpowers/specs/bar.md'); await p.waitForTimeout(700);
  const after = await snapshot();

  let moved = 0; const movedIds = [];
  for (const id in before) { if (after[id]) { const d = Math.hypot(after[id].x - before[id].x, after[id].y - before[id].y); if (d > 1) { moved++; movedIds.push((before[id].folder || before[id].file || before[id].kind) + ' Δ' + Math.round(d)); } } }
  const added = Object.keys(after).filter((id) => !before[id]).length;

  // un 2e spawn (nouvelle branche) -> idem
  const before2 = await snapshot();
  await open('src/b/y.py'); await p.waitForTimeout(700);
  const after2 = await snapshot();
  let moved2 = 0; for (const id in before2) { if (after2[id] && Math.hypot(after2[id].x - before2[id].x, after2[id].y - before2[id].y) > 1) moved2++; }

  out.movedAfterSpawn1 = moved; out.movedExamples = movedIds.slice(0, 5); out.addedAfterSpawn1 = added;
  out.movedAfterSpawn2 = moved2;
  out.overlaps = await overlaps();
  out.nodes = Object.keys(after2).length;
  await p.screenshot({ path: join(OUT, 'stable.png') });
  await p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel', 'gitbranch', 'fileexplorer', 'chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });

  console.log('RESULT:', JSON.stringify(out, null, 2));
  const pass = out.movedAfterSpawn1 === 0 && out.movedAfterSpawn2 === 0 && out.addedAfterSpawn1 >= 1 && out.overlaps === 0;
  console.log(pass ? '✅ PASS — placement STABLE (0 node existant déplacé au spawn, nouveau node posé sans chevauchement)' : '❌ FAIL');
} catch (e) { logs.push('[script-error] ' + e.message); console.log('RESULT:', JSON.stringify(out, null, 2)); }
finally {
  const errs = logs.filter((l) => l.startsWith('[console]') || l.startsWith('[pageerror]') || l.startsWith('[script-error]'));
  console.log('CONSOLE_ERRORS:', errs.length); errs.forEach((x) => console.log('  ', x));
  await b.close();
}
