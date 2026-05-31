// Valide le placement des éditeurs spawnés (F3a) : plus LOIN de l'explorateur, positions ALÉATOIRES
// (dispersion 2D, pas en grille/colonne), et AUCUN câble ne passe sous une node (via MekiCables.pathHits).
// Spawne 6 éditeurs via la vraie logique (bypass Claude), mesure, puis nettoie. Screenshot + console.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.pw');
mkdirSync(OUT, { recursive: true });
const FILES = ['mekistudio/cli.py', 'mekistudio/__init__.py', 'mekistudio/backend/models.py',
  'mekistudio/backend/paths.py', 'mekistudio/frontend/app.py', 'mekistudio/backend/fs.py'];
const logs = [];
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(1500);

  // spawn 6 éditeurs via la vraie logique du composant (déterministe, sans appel API Claude)
  await p.evaluate(async (files) => {
    let comp;
    for (const el of document.querySelectorAll('[x-data]')) { const d = window.Alpine && window.Alpine.$data(el); if (d && d.spawnEphemeralEditor) { comp = d; break; } }
    if (!comp) { window.__noComp = true; return; }
    for (const f of files) await comp.spawnEphemeralEditor(f);
  }, FILES);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: join(OUT, 'spawn-layout.png') });

  const r = await p.evaluate((files) => {
    const K = window.MekiCables;
    const boxOf = (w) => ({ x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0, w: w.offsetWidth, h: w.offsetHeight });
    const parse = (d) => { const n = (d || '').match(/-?\d+(\.\d+)?/g) || []; const pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: +n[i], y: +n[i + 1] }); return pts; };
    const wraps = [...document.querySelectorAll('.node-wrap')];
    const ex = document.querySelector('.node-wrap[data-kind="fileexplorer"]');
    const exb = boxOf(ex); const exC = { x: exb.x + exb.w / 2, y: exb.y + exb.h / 2 };
    const mine = wraps.filter((w) => w.dataset.kind === 'fileeditor' && files.some((f) => (w.dataset.file || '') === f));
    const dists = [], xs = [], ys = []; let cableHits = 0; const hitFiles = [];
    for (const w of mine) {
      const bb = boxOf(w); const c = { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
      dists.push(Math.round(Math.hypot(c.x - exC.x, c.y - exC.y))); xs.push(c.x); ys.push(c.y);
      const g = document.querySelector('.world svg.cables g[data-edge="' + w.dataset.id + '"]');
      if (g) {
        const core = g.querySelector('.cable-core');
        const pts = parse(core && core.getAttribute('d'));
        const obstacles = wraps.filter((o) => o.dataset.id !== w.dataset.id && o.dataset.kind !== 'fileexplorer').map(boxOf);
        if (pts.length >= 2 && K.pathHits(pts, obstacles)) { cableHits++; hitFiles.push(w.dataset.file); }
      }
    }
    const range = (a) => (a.length ? Math.round(Math.max(...a) - Math.min(...a)) : 0);
    return { count: mine.length, minDist: dists.length ? Math.min(...dists) : 0, distances: dists, spreadX: range(xs), spreadY: range(ys), cableHits, hitFiles, noComp: !!window.__noComp };
  }, FILES);

  // nettoyage : supprime les éditeurs spawnés (laisser le canvas propre)
  await p.evaluate(async (files) => {
    const w = [...document.querySelectorAll('.node-wrap')].filter((x) => x.dataset.kind === 'fileeditor' && files.some((f) => (x.dataset.file || '') === f));
    for (const x of w) { try { await fetch('/api/canvas/nodes/' + x.dataset.id, { method: 'DELETE' }); } catch (e) {} }
  }, FILES);

  console.log('RESULT:', JSON.stringify(r));
  const ok = !r.noComp && r.count >= 4 && r.minDist >= 500 && r.spreadX >= 300 && r.spreadY >= 300 && r.cableHits === 0;
  console.log(ok ? '✅ PASS — plus loin (minDist≥500) + dispersion 2D + 0 câble sous une node' : '❌ FAIL');
} catch (e) { logs.push(`[script-error] ${e.message}`); }
finally {
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[script-error]'));
  console.log('CONSOLE_ERRORS:', errs.length); errs.forEach((x) => console.log('  ', x));
  await b.close();
}
