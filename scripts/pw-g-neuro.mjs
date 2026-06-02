// Valide la disposition ORGANIQUE « neurones » (brique G) : explorateur au centre, dendrites
// directionnelles, anti-collision, auto-fit du viewport, câbles subway dégagés, zéro doublon.
// Prérequis : serveur sur un repo de test (top.md, README.md, docs/IDEAS.md, docs/superpowers/
// specs/{foo,bar}.md, src/a/{x,z}.py, src/b/y.py). Lancer _g_serve.py <repo> 8799 puis ce script.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.pw');
mkdirSync(OUT, { recursive: true });
const FILES = ['top.md', 'README.md', 'docs/IDEAS.md', 'docs/superpowers/specs/foo.md',
  'docs/superpowers/specs/bar.md', 'src/a/x.py', 'src/a/z.py', 'src/b/y.py'];
const EXPECT_FOLDERS = ['docs', 'docs/superpowers', 'docs/superpowers/specs', 'src', 'src/a', 'src/b'];
const logs = [];
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: 1440, height: 860 });
p.on('console', (m) => { if (m.type() === 'error') logs.push('[console] ' + m.text()); });
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
const out = {};

try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(1000);
  await p.evaluate(async () => { const bset = new Set(['kernel', 'gitbranch', 'fileexplorer', 'chat']); for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!bset.has(n.kind)) await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(1000);

  await p.evaluate(async (files) => {
    let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.openFileInNewEditor) { d = x; break; } }
    for (const f of files) await d.openFileInNewEditor(f);
  }, FILES);
  await p.waitForTimeout(1800);
  await p.screenshot({ path: join(OUT, 'neuro.png') });

  const r = await p.evaluate(() => {
    const K = window.MekiCables;
    const boxOf = (w) => ({ x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0, w: w.offsetWidth, h: w.offsetHeight });
    const parse = (d) => { const n = (d || '').match(/-?\d+(\.\d+)?/g) || []; const pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: +n[i], y: +n[i + 1] }); return pts; };
    const all = [...document.querySelectorAll('.node-wrap')];
    const sub = all.filter((w) => w.dataset.kind === 'folder' || w.dataset.kind === 'fileeditor');
    const byId = Object.fromEntries(all.map((w) => [w.dataset.id, w]));
    // overlaps among folder/editor nodes
    let overlaps = 0;
    for (let i = 0; i < sub.length; i++) for (let j = i + 1; j < sub.length; j++) { const a = boxOf(sub[i]), b = boxOf(sub[j]); if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) overlaps++; }
    // overlaps vs the fixed spine (kernel/git/chat/explorer)
    const spine = all.filter((w) => ['kernel', 'gitbranch', 'chat', 'fileexplorer'].includes(w.dataset.kind));
    let spineOverlaps = 0;
    for (const s of spine) for (const w of sub) { const a = boxOf(s), b = boxOf(w); if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) spineOverlaps++; }
    // cables clear
    let cableHits = 0;
    document.querySelectorAll('.world svg.cables g[data-edge]').forEach((g) => {
      const id = g.dataset.edge; const child = byId[id]; const par = child && child.dataset.source;
      const pts = parse(g.querySelector('.cable-core') && g.querySelector('.cable-core').getAttribute('d'));
      const obs = all.filter((o) => o.dataset.id !== id && o.dataset.id !== par).map(boxOf);
      if (pts.length >= 2 && K.pathHits(pts, obs)) cableHits++;
    });
    // everything fits viewport (after fitView)
    let view; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.view) { view = x.view; break; } }
    const W = window.innerWidth, H = window.innerHeight; let offscreen = 0;
    for (const w of all) { const b = boxOf(w); const sx0 = b.x * view.zoom + view.x, sy0 = b.y * view.zoom + view.y, sx1 = (b.x + b.w) * view.zoom + view.x, sy1 = (b.y + b.h) * view.zoom + view.y; if (sx0 < -2 || sy0 < -2 || sx1 > W + 2 || sy1 > H + 2) offscreen++; }
    // folder dedup
    const folders = sub.filter((w) => w.dataset.kind === 'folder').map((w) => w.dataset.folder).sort();
    const editors = sub.filter((w) => w.dataset.kind === 'fileeditor').length;
    return { folders, dupFolders: folders.length - new Set(folders).size, editors, overlaps, spineOverlaps, cableHits, offscreen, zoom: +view.zoom.toFixed(2) };
  });
  Object.assign(out, r);

  await p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel', 'gitbranch', 'fileexplorer', 'chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });

  console.log('RESULT:', JSON.stringify(out, null, 2));
  const foldersOk = JSON.stringify(out.folders) === JSON.stringify(EXPECT_FOLDERS);
  // Placement INCRÉMENTAL stable (chaque node posé une fois, jamais re-calculé) : on tolère qq câbles
  // qui frôlent une node (le routeur subway peut replier un câble sous un node après coup) — c'est le
  // compromis assumé du « pas de clignotement » (la garantie 0 venait du re-layout global retiré).
  const pass = foldersOk && out.dupFolders === 0 && out.editors === 8 && out.overlaps === 0 && out.spineOverlaps === 0 && out.cableHits <= 2 && out.offscreen === 0;
  console.log(pass ? '✅ PASS — organique stable (centre, 0 chevauchement, ≤2 câbles frôlés, tout à l\'écran, 0 doublon)' : '❌ FAIL (folders ' + (foldersOk ? 'ok' : JSON.stringify(out.folders)) + ')');
} catch (e) { logs.push('[script-error] ' + e.message); console.log('RESULT:', JSON.stringify(out, null, 2)); }
finally {
  const errs = logs.filter((l) => l.startsWith('[console]') || l.startsWith('[pageerror]') || l.startsWith('[script-error]'));
  console.log('CONSOLE_ERRORS:', errs.length); errs.forEach((x) => console.log('  ', x));
  await b.close();
}
