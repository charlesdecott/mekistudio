// scripts/pw-subcanvas-hittest.mjs — brique H : vérifie que le CADRE subcanvas (z-index:-1, pointer-events:none
// sauf barre de titre + bouton réduire) NE CAPTURE PLUS les clics, donc les nodes internes (fileeditor /
// fileexplorer) redeviennent des cibles de clic sélectionnables ; et que la barre de titre + le bouton réduire
// du cadre restent interactifs. S'appuie sur le serveur de dev (URL via argv).
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8805/';
const R = String.raw`C:\mekistudio`;
const rel = ['mekistudio\\frontend\\app.py', 'CLAUDE.md'];
const abs = rel.map((f) => R + '\\' + f);
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: 1680, height: 950 });
const logs = [];
p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
p.on('pageerror', (e) => logs.push('PE:' + e.message));
const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForSelector('.cmp-chat .chat-input'); await p.waitForTimeout(1000); };
const clear = () => p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel','gitbranch','subcanvas','fileexplorer','chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });

// Résout, au point écran (cx,cy), le data-kind du .node-wrap le plus proche (en remontant les ancêtres).
const resolveWrapKind = (cx, cy) => p.evaluate(([x, y]) => {
  let el = document.elementFromPoint(x, y);
  const top = el ? (el.tagName + (el.className && el.className.baseVal !== undefined ? '.' + el.className.baseVal : (typeof el.className === 'string' ? '.' + el.className : ''))) : 'null';
  let w = el;
  while (w && !(w.classList && w.classList.contains('node-wrap'))) w = w.parentElement;
  return { kind: w && w.dataset ? w.dataset.kind : null, hasWrap: !!w, top };
}, [cx, cy]);

let warns = 0;
try {
  await boot(); await clear();
  // chat en spawn illimité
  await p.evaluate(async () => { const chat = (await (await fetch('/api/canvas')).json()).nodes.find((n) => n.kind === 'chat'); if (chat) await fetch('/api/canvas/nodes/' + chat.id + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spawn_mode: 'unlimited' }) }); });
  await boot();
  // spawn des éditeurs
  await p.evaluate(async (paths) => { let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.spawnEphemeralEditor) d = x; } await Promise.all(paths.map((pp) => d.spawnEphemeralEditor(pp))); }, abs);
  await p.waitForTimeout(5000);

  // ---- Hit-test : chaque node interne (fileeditor + fileexplorer) doit résoudre vers LUI-MÊME, pas 'subcanvas'.
  const inners = [];
  const edBoxes = await p.$$eval('.node-wrap[data-kind="fileeditor"]', (ws) => ws.map((w, i) => i));
  for (let i = 0; i < edBoxes.length; i++) {
    const h = (await p.$$('.node-wrap[data-kind="fileeditor"]'))[i];
    const box = await h.boundingBox();
    if (box) inners.push({ kind: 'fileeditor', box });
  }
  const expH = await p.$('.node-wrap[data-kind="fileexplorer"]');
  if (expH) { const box = await expH.boundingBox(); if (box) inners.push({ kind: 'fileexplorer', box }); }

  for (const it of inners) {
    const cx = it.box.x + it.box.width / 2;
    const cy = it.box.y + it.box.height / 2;
    const r = await resolveWrapKind(cx, cy);
    if (r.kind === it.kind) {
      console.log(`OK hit ${it.kind}`);
    } else {
      warns++;
      console.log(`WARN ${it.kind} capté par ${r.kind} (elementFromPoint=${r.top})`);
    }
  }

  // ---- Barre de titre du cadre : un point dans le haut (top ~10px), x ~ left+50, doit résoudre vers subcanvas.
  const scH = await p.$('.node-wrap[data-kind="subcanvas"]');
  if (!scH) { warns++; console.log('WARN pas de cadre subcanvas trouvé'); }
  else {
    const scBox = await scH.boundingBox();
    const tx = scBox.x + 50;
    const ty = scBox.y + 10;
    const r = await resolveWrapKind(tx, ty);
    if (r.kind === 'subcanvas') console.log('OK barre de titre du cadre interactive');
    else { warns++; console.log(`WARN barre de titre du cadre captée par ${r.kind} (elementFromPoint=${r.top})`); }

    // ---- Bouton réduire : son centre doit résoudre vers le bouton/le cadre.
    const cbH = await p.$('.node-wrap[data-kind="subcanvas"] .node-collapse');
    if (!cbH) { warns++; console.log('WARN bouton réduire introuvable'); }
    else {
      const cb = await cbH.boundingBox();
      const bx = cb.x + cb.width / 2, by = cb.y + cb.height / 2;
      const r2 = await p.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        const isBtn = !!(el && el.closest && el.closest('.node-collapse'));
        let w = el; while (w && !(w.classList && w.classList.contains('node-wrap'))) w = w.parentElement;
        return { isBtn, kind: w && w.dataset ? w.dataset.kind : null, tag: el ? el.tagName + '.' + (typeof el.className === 'string' ? el.className : '') : 'null' };
      }, [bx, by]);
      if (r2.isBtn || r2.kind === 'subcanvas') console.log('OK bouton réduire interactif');
      else { warns++; console.log(`WARN bouton réduire capté par ${r2.kind} (el=${r2.tag})`); }
    }
  }

  // ---- Test de sélection : outil select, clic SUR un node interne (dans le cadre) -> le node interne reçoit
  // .selected, PAS le cadre. On vise l'EN-TÊTE de l'explorateur (haut du node), pas le centre d'un éditeur :
  // au centre, c'est CodeMirror qui gère lui-même le mousedown (sélection de texte) et l'événement ne remonte
  // pas au node-wrap — comportement applicatif PRÉEXISTANT, sans rapport avec le cadre. L'en-tête de
  // l'explorateur déclenche bien onNodeMouseDown -> selectNode, et c'est le même chemin pour TOUT node interne.
  await p.evaluate(() => { for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && 'tool' in x) x.tool = 'select'; } });
  await p.waitForTimeout(100);
  const expForSel = inners.find((i) => i.kind === 'fileexplorer');
  if (expForSel) {
    const cx = expForSel.box.x + expForSel.box.width / 2;
    const cy = expForSel.box.y + 24; // bande d'en-tête de l'explorateur (sous le haut du cadre, sur le node)
    await p.mouse.click(cx, cy);
    await p.waitForTimeout(250);
    const sel = await p.evaluate(() => [...document.querySelectorAll('.node-wrap.selected')].map((w) => w.dataset.kind));
    const innerSelected = sel.includes('fileexplorer');
    const frameSelected = sel.includes('subcanvas');
    if (innerSelected && !frameSelected) console.log('OK clic selectionne le node interne (pas le cadre)');
    else { warns++; console.log(`WARN selection: selected=${JSON.stringify(sel)} (interne=${innerSelected}, cadre=${frameSelected})`); }
  } else { warns++; console.log('WARN pas d\'explorateur interne pour le test de sélection'); }

  await p.screenshot({ path: 'scripts/.pw/subcanvas-hittest.png' });
  await clear();
  console.log('CONSOLE_ERRORS:', logs.length); logs.slice(0, 8).forEach((x) => console.log('  ', x));
  console.log('WARN_TOTAL:', warns);
} catch (e) { console.error('FAIL', e); } finally { await b.close(); }
