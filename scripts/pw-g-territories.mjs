// Valide les TERRITOIRES « pont » (option B) : zone d'un dossier = ses fichiers (la node dossier
// n'est PAS dans sa zone, elle fait le pont). Vérifie : fichiers DANS la zone de leur dossier,
// chevauchements de zones (répulsion B -> doit être ~0), câbles fichier courts. Nodes RÉDUITS (read).
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
await p.setViewportSize({ width: 1600, height: 900 });
p.on('console', (m) => { if (m.type() === 'error') logs.push('[console] ' + m.text()); });
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
const out = {};

const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }); await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 }); await p.waitForTimeout(900); };
const open = (f) => p.evaluate(async (path) => { let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.openFileInNewEditor) d = x; } await d.openFileInNewEditor(path); }, f);
const collapseEditors = () => p.evaluate(() => { document.querySelectorAll('.node-wrap[data-kind="fileeditor"]').forEach((w) => { if (!w.classList.contains('collapsed')) { const btn = w.querySelector('.node-collapse'); if (btn) btn.click(); } }); });
const redraw = () => p.evaluate(() => { for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.drawCables) { x.drawCables(); break; } } });

try {
  await boot();
  await p.evaluate(async () => { const bs = new Set(['kernel', 'gitbranch', 'fileexplorer', 'chat']); for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!bs.has(n.kind)) await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); });
  await boot();

  for (const f of ['src/a/x.py', 'src/a/z.py', 'src/b/y.py', 'docs/superpowers/specs/foo.md', 'docs/superpowers/specs/bar.md']) { await open(f); await p.waitForTimeout(420); }
  await collapseEditors(); await p.waitForTimeout(500); await redraw(); await p.waitForTimeout(300);

  const data = await p.evaluate(() => {
    const svgNS = 'http://www.w3.org/2000/svg';
    const tmp = document.createElementNS(svgNS, 'svg'); document.body.appendChild(tmp);
    const polyOf = (d) => { const pe = document.createElementNS(svgNS, 'path'); pe.setAttribute('d', d); tmp.appendChild(pe); const L = pe.getTotalLength(); const pts = []; const N = 140; for (let i = 0; i < N; i++) { const q = pe.getPointAtLength(L * i / N); pts.push({ x: q.x, y: q.y }); } return pts; };
    const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y; if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) c = !c; } return c; };
    const overlap = (A, B) => A.some((pt) => inPoly(pt, B)) || B.some((pt) => inPoly(pt, A));
    const ctr = (w) => ({ x: (parseFloat(w.style.left) || 0) + w.offsetWidth / 2, y: (parseFloat(w.style.top) || 0) + w.offsetHeight / 2 });

    const terris = [...document.querySelectorAll('.territories path[data-terri]')];
    const polys = {}; terris.forEach((t) => { polys[t.dataset.terri] = polyOf(t.getAttribute('d')); });

    // chaque FICHIER doit être dans la zone de son dossier (data-source)
    let fileIn = 0, fileTot = 0;
    document.querySelectorAll('.node-wrap[data-kind="fileeditor"][data-source]').forEach((w) => { const poly = polys[w.dataset.source]; if (!poly) return; fileTot++; if (inPoly(ctr(w), poly)) fileIn++; });

    // RÈGLE 1 : aucune paire de zones ne se chevauche (strict -> 0)
    const ids = Object.keys(polys); let overlaps = 0; const pairs = [];
    const pathOf = (id) => { const w = document.querySelector('.node-wrap[data-id="' + id + '"]'); return w ? (w.dataset.folder || id) : id; };
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (overlap(polys[ids[i]], polys[ids[j]])) { overlaps++; pairs.push(pathOf(ids[i]) + ' × ' + pathOf(ids[j])); }
    // RÈGLE 2 : aucune node DOSSIER ne doit être DANS une zone (elle fait le pont dans le vide -> 0)
    let folderInZone = 0; const finz = [];
    document.querySelectorAll('.node-wrap[data-kind="folder"]').forEach((w) => {
      const c = ctr(w);
      for (const id of ids) { if (id !== w.dataset.id && inPoly(c, polys[id])) { folderInZone++; finz.push((w.dataset.folder || w.dataset.id) + ' ∈ ' + pathOf(id)); break; } }
    });

    const fileCables = [...document.querySelectorAll('.cables g.cab-file .cable-core')];
    const lens = fileCables.map((c) => c.getTotalLength());
    const avgFile = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0;
    const maxFile = lens.length ? Math.round(Math.max(...lens)) : 0;
    // distance À VOL D'OISEAU fichier -> son dossier (placement seul, sans détour de routage)
    const sd = [];
    document.querySelectorAll('.node-wrap[data-kind="fileeditor"][data-source]').forEach((w) => {
      const f = document.querySelector('.node-wrap[data-id="' + w.dataset.source + '"]'); if (!f) return;
      sd.push(Math.hypot(ctr(w).x - ctr(f).x, ctr(w).y - ctr(f).y));
    });
    const avgStraight = sd.length ? Math.round(sd.reduce((a, b) => a + b, 0) / sd.length) : 0;
    const maxStraight = sd.length ? Math.round(Math.max(...sd)) : 0;

    tmp.remove();
    return { terriCount: terris.length, fileTot, fileIn, overlaps, pairs, folderInZone, finz, avgFileCable: avgFile, maxFileCable: maxFile, avgStraight, maxStraight };
  });
  Object.assign(out, data);

  await p.screenshot({ path: join(OUT, 'territories.png') });
  await p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel', 'gitbranch', 'fileexplorer', 'chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });

  console.log('RESULT:', JSON.stringify(out, null, 2));
  const pass = out.terriCount >= 2 && out.fileTot > 0 && out.fileIn === out.fileTot;
  console.log(pass ? '✅ chaque fichier est DANS la zone de son dossier' : '⚠️ certains fichiers hors zone (voir RESULT)');
  console.log(out.overlaps === 0 ? '✅ règle 2 : aucune zone ne se chevauche (répulsion B OK)' : ('⚠️ ' + out.overlaps + ' chevauchement(s) : ' + out.pairs.join(', ')));
} catch (e) { logs.push('[script-error] ' + e.message + '\n' + e.stack); console.log('RESULT:', JSON.stringify(out, null, 2)); }
finally {
  const errs = logs.filter((l) => l.startsWith('[console]') || l.startsWith('[pageerror]') || l.startsWith('[script-error]'));
  console.log('CONSOLE_ERRORS:', errs.length); errs.forEach((x) => console.log('  ', x));
  await b.close();
}
