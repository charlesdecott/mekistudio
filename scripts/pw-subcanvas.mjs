// scripts/pw-subcanvas.mjs — valide la brique H : le cadre subcanvas enveloppe l'explorateur +
// les éditeurs ouverts ; chat (top-level) ne chevauche pas le cadre ; repli -> tuile + contenus
// masqués ; 0 erreur console. S'appuie sur le serveur de dev (port via argv).
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8797/';
const R = String.raw`C:\mekistudio`;
const rel = ['mekistudio\\frontend\\app.py', 'CLAUDE.md', 'docs\\ROADMAP.md'];
const abs = rel.map((f) => R + '\\' + f);
const b = await chromium.launch(); const p = await b.newPage();
await p.setViewportSize({ width: 1680, height: 950 });
const logs = []; p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
p.on('pageerror', (e) => logs.push('PE:' + e.message));
const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForSelector('.cmp-chat .chat-input'); await p.waitForTimeout(1000); };
const clear = () => p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel','gitbranch','subcanvas','fileexplorer','chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });
const rectOf = (sel) => p.evaluate((s) => { const w = document.querySelector(s); if (!w) return null; return { x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0, w: w.offsetWidth, h: w.offsetHeight }; }, sel);
const contains = (o, i) => i && o && i.x >= o.x - 1 && i.y >= o.y - 1 && i.x + i.w <= o.x + o.w + 1 && i.y + i.h <= o.y + o.h + 1;
const overlap = (a, b2) => a && b2 && a.x < b2.x + b2.w && b2.x < a.x + a.w && a.y < b2.y + b2.h && b2.y < a.y + a.h;
try {
  await boot(); await clear();
  await p.evaluate(async () => { const chat = (await (await fetch('/api/canvas')).json()).nodes.find((n) => n.kind === 'chat'); if (chat) await fetch('/api/canvas/nodes/' + chat.id + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spawn_mode: 'unlimited' }) }); });
  await boot();
  await p.evaluate(async (paths) => { let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.spawnEphemeralEditor) d = x; } await Promise.all(paths.map((pp) => d.spawnEphemeralEditor(pp))); }, abs);
  await p.waitForTimeout(5000);
  await p.screenshot({ path: 'scripts/.pw/subcanvas.png' });
  const sc = await rectOf('.node-wrap[data-kind="subcanvas"]');
  const exp = await rectOf('.node-wrap[data-kind="fileexplorer"]');
  const eds = await p.$$eval('.node-wrap[data-kind="fileeditor"]', (ws) => ws.map((w) => ({ x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0, w: w.offsetWidth, h: w.offsetHeight })));
  const expIn = contains(sc, exp);
  const edsIn = eds.filter((e) => contains(sc, e)).length;
  const chat = await rectOf('.node-wrap[data-kind="chat"]');
  const chatClear = !overlap(sc, chat);
  console.log(JSON.stringify({ sc, expIn, edsTot: eds.length, edsIn, chatClear }, null, 2));
  console.log(expIn ? 'OK explorateur DANS le cadre' : 'WARN explorateur hors cadre');
  console.log(edsIn === eds.length && eds.length > 0 ? 'OK tous les editeurs DANS le cadre' : 'WARN editeurs hors cadre: ' + (eds.length - edsIn) + '/' + eds.length);
  console.log(chatClear ? 'OK chat ne chevauche pas le cadre' : 'WARN chat chevauche le cadre');
  await p.evaluate(() => { const w = document.querySelector('.node-wrap[data-kind="subcanvas"] .node-collapse'); if (w) w.click(); });
  await p.waitForTimeout(800);
  const scC = await rectOf('.node-wrap[data-kind="subcanvas"]');
  const hidden = await p.$$eval('.node-wrap[data-kind="fileeditor"]', (ws) => ws.length > 0 && ws.every((w) => getComputedStyle(w).display === 'none'));
  console.log((scC && scC.h <= 60 && hidden) ? 'OK repli -> tuile + contenus masques' : 'WARN repli incomplet (h=' + (scC&&scC.h) + ', hidden=' + hidden + ')');
  await clear();
  console.log('CONSOLE_ERRORS:', logs.length); logs.slice(0, 8).forEach((x) => console.log('  ', x));
} catch (e) { console.error('FAIL', e); } finally { await b.close(); }
