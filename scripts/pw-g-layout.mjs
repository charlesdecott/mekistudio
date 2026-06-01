// Valide la DISPOSITION EN ARBRE LISIBLE (brique G) : on ouvre des fichiers formant des chaînes
// ET des bifurcations, puis on vérifie que la disposition est hiérarchique et suivable :
//  - chaque enfant est À DROITE de son parent (la profondeur croît vers la droite) ;
//  - aucun node (dossier/éditeur) n'en chevauche un autre ;
//  - aucun câble ne passe sous une node ;
//  - les éditeurs (fichiers) sont les feuilles les plus à droite.
// Prérequis : serveur sur le repo de test (top.md, docs/superpowers/specs/{foo,bar}.md, src/a/{x,z}.py,
// src/b/y.py). Lancer : uv run python scripts/_g_serve.py <repo_test> 8799 ; puis node scripts/pw-g-layout.mjs.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.pw');
mkdirSync(OUT, { recursive: true });
const FILES = [
  'docs/superpowers/specs/foo.md', 'docs/superpowers/specs/bar.md',
  'src/a/x.py', 'src/a/z.py', 'src/b/y.py', 'top.md',
];
const logs = [];
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', (m) => { if (m.type() === 'error') logs.push('[console] ' + m.text()); });
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
const out = {};

try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(1000);
  // état propre
  await p.evaluate(async () => { const bset = new Set(['kernel', 'gitbranch', 'fileexplorer', 'chat']); for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!bset.has(n.kind)) await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(1000);

  // ouvre les fichiers (chaînes + bifurcations) via la vraie logique
  await p.evaluate(async (files) => {
    let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.openFileInNewEditor) { d = x; break; } }
    for (const f of files) await d.openFileInNewEditor(f);
  }, FILES);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: join(OUT, 'g-layout.png') });
  // vue d'ensemble dézoomée pour juger la lisibilité globale
  await p.evaluate(() => { let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.view) { d = x; break; } } d.view = { x: 60, y: 80, zoom: 0.32 }; });
  await p.waitForTimeout(600);
  await p.screenshot({ path: join(OUT, 'g-layout-overview.png') });

  const r = await p.evaluate(() => {
    const K = window.MekiCables;
    const boxOf = (w) => ({ x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0, w: w.offsetWidth, h: w.offsetHeight });
    const cx = (b) => b.x + b.w / 2;
    const parse = (d) => { const n = (d || '').match(/-?\d+(\.\d+)?/g) || []; const pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: +n[i], y: +n[i + 1] }); return pts; };
    const all = [...document.querySelectorAll('.node-wrap')];
    const sub = all.filter((w) => w.dataset.kind === 'folder' || w.dataset.kind === 'fileeditor');
    const byId = Object.fromEntries(all.map((w) => [w.dataset.id, w]));

    // 1) chaque enfant à droite de son parent (profondeur -> droite)
    let depthViolations = 0; const dv = [];
    for (const w of sub) {
      const par = byId[w.dataset.source];
      if (!par) continue;
      if (cx(boxOf(w)) <= cx(boxOf(par)) + 1) { depthViolations++; dv.push((w.dataset.folder || w.dataset.file) + ' !> ' + (par.dataset.folder || par.dataset.kind)); }
    }

    // 2) aucun chevauchement entre nodes dossier/éditeur
    let overlaps = 0;
    for (let i = 0; i < sub.length; i++) for (let j = i + 1; j < sub.length; j++) {
      const a = boxOf(sub[i]), b = boxOf(sub[j]);
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
    }

    // 3) câbles dégagés
    let cableHits = 0;
    document.querySelectorAll('.world svg.cables g[data-edge]').forEach((g) => {
      const childId = g.dataset.edge; const child = byId[childId]; const parentId = child && child.dataset.source;
      const pts = parse(g.querySelector('.cable-core') && g.querySelector('.cable-core').getAttribute('d'));
      const obs = all.filter((o) => o.dataset.id !== childId && o.dataset.id !== parentId).map(boxOf);
      if (pts.length >= 2 && K.pathHits(pts, obs)) cableHits++;
    });

    // 4) éditeurs = feuilles les plus à droite (max x parmi sub est un éditeur)
    const maxX = Math.max(...sub.map((w) => boxOf(w).x));
    const rightmost = sub.filter((w) => boxOf(w).x === maxX);
    const rightmostAllEditors = rightmost.every((w) => w.dataset.kind === 'fileeditor');

    return {
      nodes: sub.length, editors: sub.filter((w) => w.dataset.kind === 'fileeditor').length,
      folders: sub.filter((w) => w.dataset.kind === 'folder').length,
      depthViolations, dv, overlaps, cableHits, rightmostAllEditors,
    };
  });
  Object.assign(out, r);

  // nettoyage
  await p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel', 'gitbranch', 'fileexplorer', 'chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });

  console.log('RESULT:', JSON.stringify(out, null, 2));
  const pass = out.nodes >= 9 && out.depthViolations === 0 && out.overlaps === 0 && out.cableHits === 0 && out.rightmostAllEditors;
  console.log(pass ? '✅ PASS — arbre lisible (profondeur->droite, 0 chevauchement, 0 câble sous une node, fichiers en feuilles)' : '❌ FAIL');
} catch (e) { logs.push('[script-error] ' + e.message); console.log('RESULT:', JSON.stringify(out, null, 2)); }
finally {
  const errs = logs.filter((l) => l.startsWith('[console]') || l.startsWith('[pageerror]') || l.startsWith('[script-error]'));
  console.log('CONSOLE_ERRORS:', errs.length); errs.forEach((x) => console.log('  ', x));
  await b.close();
}
