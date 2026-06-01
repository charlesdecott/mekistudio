// Valide la brique G (organisation des nodes) en navigateur réel :
//  1. node git : affiche la branche (⎇ master) + réductible (collapsed -> détail masqué).
//  2. topologie : kernel -> git -> { chat, explorateur }.
//  3. dossiers-en-nodes (chaîne complète) : ouvrir docs/superpowers/specs/foo.md crée la chaîne
//     docs/ -> docs/superpowers/ -> docs/superpowers/specs/ et l'éditeur s'y câble (path-aware).
//  4. auto-spawn F3 groupé : spawnEphemeralEditor('src/a/x.py') -> dossiers src, src/a, éditeur sous src/a.
//  5. câbles dégagés : aucun câble ne passe sous une node (MekiCables.pathHits).
//  6. fermeture non destructive : fermer un dossier intermédiaire -> l'éditeur survit (rebranché).
//  7. compaction : toggle compact -> 1 seul node dossier fusionné pour une chaîne à enfant unique.
//
// Prérequis : un serveur sur un repo de TEST contenant top.md, docs/IDEAS.md,
// docs/superpowers/specs/foo.md, src/a/x.py, src/b/y.py (repo git). Lancer :
//   uv run python scripts/_g_serve.py <repo_test> 8799
// puis : node scripts/pw-g.mjs http://127.0.0.1:8799/
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
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const out = {};

const comp = () => p.evaluateHandle(() => {
  for (const el of document.querySelectorAll('[x-data]')) {
    const d = window.Alpine && window.Alpine.$data(el);
    if (d && d.reconcileFolderNodes) return d;
  }
  return null;
});
const canvas = () => p.evaluate(async () => (await (await fetch('/api/canvas')).json()).nodes);
const clean = () => p.evaluate(async () => {
  const builtin = new Set(['kernel', 'gitbranch', 'fileexplorer', 'chat']);
  const nodes = (await (await fetch('/api/canvas')).json()).nodes;
  for (const n of nodes) if (!builtin.has(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} }
});
const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }); await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 }); await p.waitForTimeout(1200); };

try {
  await boot();
  await clean();
  await boot();

  // 1) node git : titre branche
  out.gitTitle = await p.evaluate(() => (document.querySelector('.cmp-gitbranch .gb-title') || {}).textContent || '');

  // 1b) réduire la node git -> classe collapsed + détail masqué
  await p.evaluate(() => {
    let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.toggleCollapse) { d = x; break; } }
    const w = document.querySelector('.node-wrap[data-kind="gitbranch"]');
    const id = w.dataset.id;
    d.toggleCollapse({ id, kind: 'gitbranch', collapsed: false }, w, w.querySelector('.node-collapse'));
  });
  await p.waitForTimeout(300);
  out.gitCollapsed = await p.evaluate(() => {
    const w = document.querySelector('.node-wrap[data-kind="gitbranch"]');
    const det = w.querySelector('.gb-detail');
    return w.classList.contains('collapsed') && getComputedStyle(det).display === 'none';
  });

  // 2) topologie via API
  const nodes1 = await canvas();
  const by1 = Object.fromEntries(nodes1.map((n) => [n.kind, n]));
  out.topology = by1.gitbranch.source_id === by1.kernel.id
    && by1.chat.source_id === by1.gitbranch.id
    && by1.fileexplorer.source_id === by1.gitbranch.id;

  // 3) chaîne complète : ouvrir un fichier profond
  const c1 = await comp();
  await c1.evaluate(async (d) => { await d.openFileInNewEditor('docs/superpowers/specs/foo.md'); });
  await p.waitForTimeout(1500);
  const nodes2 = await canvas();
  const byId = Object.fromEntries(nodes2.map((n) => [n.id, n]));
  const folderByPath = Object.fromEntries(nodes2.filter((n) => n.kind === 'folder').map((n) => [n.path, n]));
  out.folders = Object.keys(folderByPath).sort();
  const ed = nodes2.find((n) => n.kind === 'fileeditor' && (n.root.children?.[0]?.children?.[0]?.file_path || '') === 'docs/superpowers/specs/foo.md');
  // chaîne de parentage : éditeur -> specs -> superpowers -> docs -> explorateur
  const chain = [];
  let cur = ed;
  for (let i = 0; i < 6 && cur && cur.source_id; i++) { cur = byId[cur.source_id]; if (cur) chain.push(cur.kind === 'folder' ? cur.path : cur.kind); }
  out.chain = chain;
  out.chainOk = ed
    && ed.source_id === (folderByPath['docs/superpowers/specs'] || {}).id
    && (folderByPath['docs/superpowers/specs'] || {}).source_id === (folderByPath['docs/superpowers'] || {}).id
    && (folderByPath['docs/superpowers'] || {}).source_id === (folderByPath['docs'] || {}).id
    && (folderByPath['docs'] || {}).source_id === by1.fileexplorer.id;

  // 4) auto-spawn groupé : src/a/x.py
  const c2 = await comp();
  await c2.evaluate(async (d) => { await d.spawnEphemeralEditor('src/a/x.py'); });
  await p.waitForTimeout(1500);
  const nodes3 = await canvas();
  const fbp3 = Object.fromEntries(nodes3.filter((n) => n.kind === 'folder').map((n) => [n.path, n]));
  const edx = nodes3.find((n) => n.kind === 'fileeditor' && (n.root.children?.[0]?.children?.[0]?.file_path || '') === 'src/a/x.py');
  out.autospawnGrouped = !!(fbp3['src'] && fbp3['src/a'] && edx && edx.source_id === fbp3['src/a'].id && fbp3['src/a'].source_id === fbp3['src'].id);

  // 5) câbles dégagés (aucun câble sous une node)
  out.cableHits = await p.evaluate(() => {
    const K = window.MekiCables;
    const boxOf = (w) => ({ x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0, w: w.offsetWidth, h: w.offsetHeight });
    const parse = (d) => { const n = (d || '').match(/-?\d+(\.\d+)?/g) || []; const pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: +n[i], y: +n[i + 1] }); return pts; };
    const wraps = [...document.querySelectorAll('.node-wrap')];
    let hits = 0;
    document.querySelectorAll('.world svg.cables g[data-edge]').forEach((g) => {
      const childId = g.dataset.edge;
      const child = document.querySelector('.node-wrap[data-id="' + childId + '"]');
      const parentId = child && child.dataset.source;
      const core = g.querySelector('.cable-core');
      const pts = parse(core && core.getAttribute('d'));
      const obstacles = wraps.filter((o) => o.dataset.id !== childId && o.dataset.id !== parentId).map(boxOf);
      if (pts.length >= 2 && K.pathHits(pts, obstacles)) hits++;
    });
    return hits;
  });
  await p.screenshot({ path: join(OUT, 'g-chain.png') });

  // 6) fermeture non destructive : fermer docs/superpowers -> foo.md survit
  await p.evaluate(() => {
    let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.closeFolderNode) { d = x; break; } }
    const w = document.querySelector('.node-wrap[data-kind="folder"][data-folder="docs/superpowers"]');
    if (w) d.closeFolderNode({ id: w.dataset.id, kind: 'folder' }, w, false);
  });
  await p.waitForTimeout(800);
  const nodes4 = await canvas();
  const edStill = nodes4.find((n) => n.kind === 'fileeditor' && (n.root.children?.[0]?.children?.[0]?.file_path || '') === 'docs/superpowers/specs/foo.md');
  out.closeNonDestructive = !!edStill; // l'éditeur a survécu à la fermeture du dossier intermédiaire

  // 7) compaction : reset, active compact, ouvre foo.md -> 1 seul node dossier
  await clean();
  await boot();
  await p.evaluate(async () => {
    const eid = (await (await fetch('/api/canvas')).json()).nodes.find((n) => n.kind === 'fileexplorer').id;
    await fetch('/api/canvas/nodes/' + eid + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compact_chain: true }) });
  });
  await boot(); // recharge -> _compactMode lu à true
  const c3 = await comp();
  out.compactModeRead = await c3.evaluate((d) => d._compactMode);
  await c3.evaluate(async (d) => { await d.openFileInNewEditor('docs/superpowers/specs/foo.md'); });
  await p.waitForTimeout(1500);
  const nodes5 = await canvas();
  out.compactFolders = nodes5.filter((n) => n.kind === 'folder').map((n) => n.path).sort();
  // chaîne à enfant unique -> un seul node "docs/superpowers/specs"
  out.compactOk = out.compactFolders.length === 1 && out.compactFolders[0] === 'docs/superpowers/specs';

  // nettoyage + remet compact à false
  await p.evaluate(async () => {
    const nodes = (await (await fetch('/api/canvas')).json()).nodes;
    const eid = nodes.find((n) => n.kind === 'fileexplorer').id;
    await fetch('/api/canvas/nodes/' + eid + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compact_chain: false }) });
    for (const n of nodes) if (!['kernel', 'gitbranch', 'fileexplorer', 'chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} }
  });

  console.log('RESULT:', JSON.stringify(out, null, 2));
  const pass = /master/.test(out.gitTitle) && out.gitCollapsed && out.topology
    && out.chainOk && JSON.stringify(out.folders) === JSON.stringify(['docs', 'docs/superpowers', 'docs/superpowers/specs'])
    && out.autospawnGrouped && out.cableHits === 0 && out.closeNonDestructive
    && out.compactModeRead === true && out.compactOk;
  console.log(pass ? '✅ PASS — brique G (git + dossiers + path-aware + placement + compaction)' : '❌ FAIL');
} catch (e) { logs.push(`[script-error] ${e.message}`); console.log('RESULT:', JSON.stringify(out, null, 2)); }
finally {
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[script-error]'));
  console.log('CONSOLE_ERRORS:', errs.length); errs.forEach((x) => console.log('  ', x));
  await b.close();
}
