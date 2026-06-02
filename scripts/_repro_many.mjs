// Reproduit le scénario RÉEL : beaucoup de fichiers lus via la comète (spawnEphemeralEditor),
// chemins ABSOLUS Windows, tirés EN CONCURRENCE (comme applyIntent qui n'await pas). Mesure les
// chevauchements de zones (blob dessiné), folder-in-zone, doublons de dossier, erreurs console.
import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8797/';
const R = String.raw`C:\mekistudio`;
const relFrontend = [
  'mekistudio\\frontend\\__init__.py', 'mekistudio\\frontend\\app.py',
  'mekistudio\\frontend\\routes\\__init__.py', 'mekistudio\\frontend\\routes\\canvas.py',
  'mekistudio\\frontend\\routes\\fs.py', 'mekistudio\\frontend\\routes\\git.py', 'mekistudio\\frontend\\routes\\chat_ws.py',
  'mekistudio\\frontend\\templates\\canvas.html', 'mekistudio\\frontend\\static\\css\\canvas.css',
  'mekistudio\\frontend\\static\\js\\canvas.js', 'mekistudio\\frontend\\static\\js\\editor.js',
  'mekistudio\\frontend\\static\\js\\chat-view.js', 'mekistudio\\frontend\\static\\js\\chat-model.js',
  'mekistudio\\frontend\\static\\js\\chat-impulses.js', 'mekistudio\\frontend\\static\\js\\folders.js',
  'mekistudio\\frontend\\static\\js\\territories.js', 'mekistudio\\frontend\\static\\js\\cables.js',
  'mekistudio\\frontend\\static\\js\\collision.js', 'mekistudio\\frontend\\static\\js\\git-node.js',
  'mekistudio\\frontend\\static\\js\\cables.test.js', 'mekistudio\\frontend\\static\\js\\collision.test.js',
  'mekistudio\\frontend\\static\\js\\chat-model.test.js', 'mekistudio\\frontend\\static\\js\\chat-impulses.test.js',
  'mekistudio\\frontend\\static\\js\\folders.test.js', 'mekistudio\\frontend\\static\\js\\territories.test.js',
  'mekistudio\\frontend\\static\\js\\git-node.test.js',
];
const abs = relFrontend.map((f) => R + '\\' + f);
const mode = process.argv[2] || 'concurrent';
const b = await chromium.launch(); const p = await b.newPage();
await p.setViewportSize({ width: 1680, height: 950 });
const logs = []; p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); p.on('pageerror', (e) => logs.push('PE:' + e.message));
const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForSelector('.cmp-chat .chat-input'); await p.waitForTimeout(1000); };
const clear = () => p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel', 'gitbranch', 'fileexplorer', 'chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });
const spawn = (paths, concurrent) => p.evaluate(async ({ paths, concurrent }) => {
  let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.spawnEphemeralEditor) d = x; }
  if (concurrent) { await Promise.all(paths.map((pp) => d.spawnEphemeralEditor(pp))); }
  else { for (const pp of paths) { await d.spawnEphemeralEditor(pp); await new Promise((r) => setTimeout(r, 120)); } }
}, { paths, concurrent });
const measure = () => p.evaluate(() => {
  const svgNS = 'http://www.w3.org/2000/svg';
  const tmp = document.createElementNS(svgNS, 'svg'); document.body.appendChild(tmp);
  const polyOf = (d) => { const pe = document.createElementNS(svgNS, 'path'); pe.setAttribute('d', d); tmp.appendChild(pe); const L = pe.getTotalLength(); const pts = []; const N = 160; for (let i = 0; i < N; i++) { const q = pe.getPointAtLength(L * i / N); pts.push({ x: q.x, y: q.y }); } return pts; };
  const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y; if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) c = !c; } return c; };
  const segX = (a, b, c, d) => { const d1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x), d2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x), d3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x), d4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)); };
  const edgesCross = (A, B) => { for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segX(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true; return false; };
  const overlap = (A, B) => A.some((pt) => inPoly(pt, B)) || B.some((pt) => inPoly(pt, A)) || edgesCross(A, B);
  const ctr = (w) => ({ x: (parseFloat(w.style.left) || 0) + w.offsetWidth / 2, y: (parseFloat(w.style.top) || 0) + w.offsetHeight / 2 });
  const terris = [...document.querySelectorAll('.territories path[data-terri]')];
  const polys = {}; terris.forEach((t) => { polys[t.dataset.terri] = polyOf(t.getAttribute('d')); });
  const ids = Object.keys(polys);
  const fpath = (id) => { const w = document.querySelector('.node-wrap[data-id="' + id + '"]'); return w ? (w.dataset.folder || id) : id; };
  let overlaps = 0; const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (overlap(polys[ids[i]], polys[ids[j]])) { overlaps++; if (pairs.length < 12) pairs.push(fpath(ids[i]) + ' × ' + fpath(ids[j])); }
  let folderInZone = 0; const finz = [];
  document.querySelectorAll('.node-wrap[data-kind="folder"]').forEach((w) => { const c = ctr(w); for (const id of ids) if (id !== w.dataset.id && inPoly(c, polys[id])) { folderInZone++; if (finz.length < 12) finz.push((w.dataset.folder) + ' ∈ ' + fpath(id)); break; } });
  const fcount = {}; document.querySelectorAll('.node-wrap[data-kind="folder"]').forEach((w) => { fcount[w.dataset.folder] = (fcount[w.dataset.folder] || 0) + 1; });
  const dupFolders = Object.entries(fcount).filter(([, n]) => n > 1);
  tmp.remove();
  return { zones: terris.length, folders: document.querySelectorAll('.node-wrap[data-kind="folder"]').length, editors: document.querySelectorAll('.node-wrap[data-kind="fileeditor"]').length, overlaps, pairs, folderInZone, finz, dupFolders };
});
try {
  await boot(); await clear();
  // mode ILLIMITÉ : tous les éditeurs persistent (pas de recyclage FIFO) -> on stresse vraiment le layout
  await p.evaluate(async () => { const chat = (await (await fetch('/api/canvas')).json()).nodes.find((n) => n.kind === 'chat'); if (chat) await fetch('/api/canvas/nodes/' + chat.id + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spawn_mode: 'unlimited' }) }); });
  await boot();
  await spawn(abs, mode === 'concurrent'); await p.waitForTimeout(6000);
  const m = await measure();
  // zoom sur le cluster fichiers+dossiers pour inspecter visuellement les zones
  await p.evaluate(() => {
    let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.view) d = x; }
    const ws = [...document.querySelectorAll('.node-wrap[data-kind="fileeditor"], .node-wrap[data-kind="folder"]')];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ws.forEach((w) => { const x = parseFloat(w.style.left) || 0, y = parseFloat(w.style.top) || 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w.offsetWidth); y1 = Math.max(y1, y + w.offsetHeight); });
    const W = window.innerWidth, H = window.innerHeight, pad = 50;
    const zoom = Math.min(W / (x1 - x0 + 2 * pad), H / (y1 - y0 + 2 * pad), 1.6);
    d.view.zoom = zoom; d.view.x = W / 2 - (x0 + x1) / 2 * zoom; d.view.y = H / 2 - (y0 + y1) / 2 * zoom;
  });
  await p.waitForTimeout(700);
  await p.screenshot({ path: 'C:/mekistudio/scripts/.pw/many-' + mode + '.png' });
  await clear();
  console.log('MODE:', mode);
  console.log(JSON.stringify(m, null, 2));
  console.log('CONSOLE_ERRORS:', logs.length); logs.slice(0, 8).forEach((x) => console.log('  ', x));
} catch (e) { console.log('SCRIPT-ERR', e.message, e.stack); }
finally { await b.close(); }
