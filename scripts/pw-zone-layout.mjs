// scripts/pw-zone-layout.mjs — valide le modèle node-zone : 0 overlap de zones, tuile dossier DANS
// sa zone (proche du centroïde), 0 erreur console. S'appuie sur le serveur de dev (port via argv).
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8797/';
const R = String.raw`C:\mekistudio`;
const rel = [
  'mekistudio\\frontend\\app.py', 'mekistudio\\frontend\\routes\\canvas.py', 'mekistudio\\frontend\\routes\\fs.py',
  'mekistudio\\frontend\\static\\js\\canvas.js', 'mekistudio\\frontend\\static\\js\\cables.js',
  'mekistudio\\frontend\\static\\js\\territories.js', 'mekistudio\\frontend\\static\\js\\zonelayout.js',
  'mekistudio\\frontend\\templates\\canvas.html', 'mekistudio\\frontend\\static\\css\\canvas.css',
];
const abs = rel.map((f) => R + '\\' + f);
const b = await chromium.launch(); const p = await b.newPage();
await p.setViewportSize({ width: 1680, height: 950 });
const logs = []; p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
p.on('pageerror', (e) => logs.push('PE:' + e.message));
const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForSelector('.cmp-chat .chat-input'); await p.waitForTimeout(1000); };
const clear = () => p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel','gitbranch','fileexplorer','chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });
try {
  await boot(); await clear();
  await p.evaluate(async () => { const chat = (await (await fetch('/api/canvas')).json()).nodes.find((n) => n.kind === 'chat'); if (chat) await fetch('/api/canvas/nodes/' + chat.id + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spawn_mode: 'unlimited' }) }); });
  await boot();
  await p.evaluate(async (paths) => { let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.spawnEphemeralEditor) d = x; } await Promise.all(paths.map((pp) => d.spawnEphemeralEditor(pp))); }, abs);
  await p.waitForTimeout(6000);
  const m = await p.evaluate(() => {
    const svgNS = 'http://www.w3.org/2000/svg';
    const tmp = document.createElementNS(svgNS, 'svg'); document.body.appendChild(tmp);
    const polyOf = (d) => { const pe = document.createElementNS(svgNS, 'path'); pe.setAttribute('d', d); tmp.appendChild(pe); const L = pe.getTotalLength(); const pts = []; for (let i = 0; i < 160; i++) { const q = pe.getPointAtLength(L * i / 160); pts.push({ x: q.x, y: q.y }); } return pts; };
    const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y; if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) c = !c; } return c; };
    const overlap = (A, B) => A.some((pt) => inPoly(pt, B)) || B.some((pt) => inPoly(pt, A));
    const ctr = (w) => ({ x: (parseFloat(w.style.left) || 0) + w.offsetWidth / 2, y: (parseFloat(w.style.top) || 0) + w.offsetHeight / 2 });
    const terris = [...document.querySelectorAll('.territories path[data-terri]')];
    const polys = {}; terris.forEach((t) => { polys[t.dataset.terri] = polyOf(t.getAttribute('d')); });
    const ids = Object.keys(polys); let overlaps = 0; const pairs = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (overlap(polys[ids[i]], polys[ids[j]])) { overlaps++; if (pairs.length < 10) pairs.push(ids[i] + '×' + ids[j]); }
    // chaque tuile dossier est DANS sa propre zone (modèle node-zone)
    let folderIn = 0, folderTot = 0;
    document.querySelectorAll('.node-wrap[data-kind="folder"]').forEach((w) => { const poly = polys[w.dataset.id]; if (!poly) return; folderTot++; if (inPoly(ctr(w), poly)) folderIn++; });
    tmp.remove();
    return { zones: terris.length, overlaps, pairs, folderTot, folderIn };
  });
  await p.screenshot({ path: 'scripts/.pw/zone-layout.png' });
  await clear();
  console.log(JSON.stringify(m, null, 2));
  console.log(m.overlaps === 0 ? '✅ 0 chevauchement de zones' : '⚠️ ' + m.overlaps + ' chevauchement(s): ' + m.pairs.join(', '));
  console.log(m.folderTot > 0 && m.folderIn === m.folderTot ? '✅ chaque tuile dossier est DANS sa zone' : '⚠️ tuiles hors zone: ' + (m.folderTot - m.folderIn));
  console.log('CONSOLE_ERRORS:', logs.length); logs.slice(0, 8).forEach((x) => console.log('  ', x));
} catch (e) { console.log('SCRIPT-ERR', e.message, e.stack); }
finally { await b.close(); }
