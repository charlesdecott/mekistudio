// scripts/pw-subcanvas-drag.mjs — valide les interactions de DRAG de la brique H :
//  (2) un node interne se drague librement (le cadre ne le bloque plus) ET le cadre AUTO-RESIZE
//      pour l'envelopper ; (3) draguer le CADRE entraîne tout son contenu. ASCII only.
// S'appuie sur le serveur de dev (URL via argv). Modele boot/clear/spawn sur pw-subcanvas.mjs.
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8802/';
const R = String.raw`C:\mekistudio`;
const rel = ['mekistudio\\frontend\\app.py', 'CLAUDE.md', 'docs\\ROADMAP.md'];
const abs = rel.map((f) => R + '\\' + f);
const b = await chromium.launch(); const p = await b.newPage();
await p.setViewportSize({ width: 1680, height: 950 });
const logs = []; p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
p.on('pageerror', (e) => logs.push('PE:' + e.message));
// Detaille les reponses HTTP en echec (4xx/5xx) -> rend les erreurs console "Failed to load resource"
// auto-explicatives (ex. 422 persist du cadre, voir rapport).
const httpFails = [];
p.on('response', async (r) => { if (r.status() >= 400) { let d = ''; try { d = (await r.text()).slice(0, 200); } catch (e) {} httpFails.push(r.status() + ' ' + r.request().method() + ' ' + r.url() + ' body=' + (r.request().postData() || '') + ' resp=' + d); } });

const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForSelector('.cmp-chat .chat-input'); await p.waitForTimeout(1000); };
const clear = () => p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel','gitbranch','subcanvas','fileexplorer','chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });
// rect en coords MONDE (style.left/top) + taille rendue, comme pw-subcanvas.mjs.
const rectOf = (sel) => p.evaluate((s) => { const w = document.querySelector(s); if (!w) return null; return { x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0, w: w.offsetWidth, h: w.offsetHeight }; }, sel);
const contains = (o, i) => i && o && i.x >= o.x - 1 && i.y >= o.y - 1 && i.x + i.w <= o.x + o.w + 1 && i.y + i.h <= o.y + o.h + 1;
const setMove = () => p.evaluate(() => { for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && 'tool' in x) x.tool = 'move'; } });
const cmp = () => p.evaluateHandle(() => { for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.view) return x; } return null; });
const getZoom = () => p.evaluate(() => { for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.view) return x.view.zoom || 1; } return 1; });
// Centre la vue (zoom=1) sur la boite englobante d'un node monde -> elements fiables a gripper.
const centerWorld = (cx, cy, z) => p.evaluate((args) => { for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.view) { x.view.zoom = args.z; x.view.x = window.innerWidth / 2 - args.cx * args.z; x.view.y = window.innerHeight / 2 - args.cy * args.z; return; } } }, { cx, cy, z });
const near = (a, b2, tol) => Math.abs(a - b2) <= tol;

try {
  // --- 1. Boot + spawn 3 editeurs ---
  await boot(); await clear();
  await p.evaluate(async () => { const chat = (await (await fetch('/api/canvas')).json()).nodes.find((n) => n.kind === 'chat'); if (chat) await fetch('/api/canvas/nodes/' + chat.id + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spawn_mode: 'unlimited' }) }); });
  await boot();
  await p.evaluate(async (paths) => { let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.spawnEphemeralEditor) d = x; } await Promise.all(paths.map((pp) => d.spawnEphemeralEditor(pp))); }, abs);
  await p.waitForTimeout(5000);
  await setMove();
  // Le fitView dezoome fort (toute l'arbre). Pour gripper de maniere fiable a la souris, on force
  // zoom=1 centre sur le cadre subcanvas (mapping ecran<->monde simple, delta_monde = delta_ecran).
  const scWorld = await rectOf('.node-wrap[data-kind="subcanvas"]');
  await centerWorld(scWorld.x + scWorld.w / 2, scWorld.y + scWorld.h / 2, 1);
  await p.waitForTimeout(600);
  const zoom = await getZoom();
  console.log('OK boot + 3 editeurs (zoom force=' + zoom.toFixed(3) + ')');

  // --- 2. Drag node interne -> il bouge + le cadre AUTO-RESIZE pour l'envelopper ---
  const edSel = '.node-wrap[data-kind="fileeditor"]';
  // On choisit l'editeur le plus a DROITE et on le drague encore plus a droite : le span du cadre
  // ne peut alors que CROITRE (auto-resize verifiable de maniere deterministe, independant du tirage).
  const scForPick = await rectOf('.node-wrap[data-kind="subcanvas"]');
  const ed0Before = await p.$$eval(edSel, (ws) => ws.map((w) => ({ id: w.dataset.id, x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0, w: w.offsetWidth })))
    .then((eds) => eds.reduce((best, e) => (e.x + e.w > best.x + best.w ? e : best)));
  void scForPick;
  // Centre la vue (zoom 1) sur CE node (position LIVE relue par id) pour le rendre grippable.
  const ed0Live = await p.evaluate((id) => { const w = document.querySelector('.node-wrap[data-id="' + id + '"]'); return w ? { x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0 } : null; }, ed0Before.id);
  await centerWorld(ed0Live.x + 130, ed0Live.y + 30, 1);
  await p.waitForTimeout(500);
  const scBefore = await rectOf('.node-wrap[data-kind="subcanvas"]');
  // box ecran du 1er editeur ; on grippe pres du HAUT (header).
  const ed0Handle = await p.$('.node-wrap[data-id="' + ed0Before.id + '"]');
  let edBox = await ed0Handle.boundingBox();
  if (!edBox) { await ed0Handle.scrollIntoViewIfNeeded(); await p.waitForTimeout(300); edBox = await ed0Handle.boundingBox(); }
  if (!edBox) throw new Error('edBox null pour editeur ' + ed0Before.id);
  const SCREEN_DX = 400;
  const worldDX = SCREEN_DX / zoom;
  const startX = edBox.x + edBox.width / 2, startY = edBox.y + 12;
  // pos LIVE de CE node, lue par id (left/top + transform translate eventuel).
  const livePos = (id) => p.evaluate((i) => { const w = document.querySelector('.node-wrap[data-id="' + i + '"]'); if (!w) return null; const m = new DOMMatrixReadOnly(getComputedStyle(w).transform); return { left: parseFloat(w.style.left)||0, top: parseFloat(w.style.top)||0, tx: m.m41||0, ty: m.m42||0 }; }, id);
  await p.mouse.move(startX, startY); await p.mouse.down();
  // 1er petit pas : le drag se "cale" sur le home (clearTranslate) -> on prend ICI la baseline du
  // suivi-curseur (sinon on mesure le snap home/rendu, pas le drag).
  await p.mouse.move(startX + 30, startY); await p.waitForTimeout(60);
  const baseDrag = await livePos(ed0Before.id);
  // suite du drag jusqu'a +400 ecran (vers l'exterieur du cadre).
  for (let s = 2; s <= 12; s++) await p.mouse.move(startX + SCREEN_DX * s / 12, startY);
  await p.waitForTimeout(60);
  const midDrag = await livePos(ed0Before.id);          // pos pendant le drag (suit le curseur)
  const scMid = await rectOf('.node-wrap[data-kind="subcanvas"]'); // cadre AU PIC (avant relachement)
  await p.mouse.up();
  await p.waitForTimeout(800);
  const ed0After = await p.evaluate((id) => { const w = document.querySelector('.node-wrap[data-id="' + id + '"]'); return w ? { x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0, w: w.offsetWidth, h: w.offsetHeight } : null; }, ed0Before.id);
  const scAfter = await rectOf('.node-wrap[data-kind="subcanvas"]');
  // delta de suivi = (left mid - left base) + translate residuel ; doit suivre le curseur (~ +370 = 400-30).
  const followDX = (midDrag.left + midDrag.tx) - (baseDrag.left + baseDrag.tx);
  const cibleSuivi = SCREEN_DX - 30; // depuis la baseline prise apres le 1er pas de 30px
  const tracks = near(followDX, cibleSuivi, Math.max(60, cibleSuivi * 0.30)); // le node SUIT le curseur
  const moved = Math.abs(followDX) >= 80;                // a bien bouge (pas bloque par le cadre)
  // AUTO-RESIZE : le cadre est dimensionne sur la boite englobante DERIVEE -> sa taille SUIT le contenu
  // (peut croitre OU se resserrer selon que le node deplace etend ou non le span). L'invariant robuste =
  // (a) la taille a CHANGE entre avant et apres (le cadre n'est PAS fige : il se recale sur le contenu)
  // ET (b) le cadre ENVELOPPE le node deplace. NB : la mesure PENDANT est indicative (transition CSS +
  // deadband -> offsetWidth pas encore stabilise), on s'appuie sur la valeur stabilisee APRES.
  const resized = scAfter && scBefore && Math.abs(scAfter.w - scBefore.w) >= 20;  // le cadre s'est recale
  const frameWraps = scAfter && contains(scAfter, ed0After);                      // le cadre enveloppe le node
  console.log('  [interne] suivi_curseur dx=' + Math.round(followDX) + ' (cible~' + Math.round(cibleSuivi) + ') suit=' + tracks + ' bouge=' + moved);
  console.log('  [interne] cadre w: avant=' + Math.round(scBefore.w) + ' (pendant~' + Math.round(scMid.w) + ') apres=' + Math.round(scAfter.w) + ' (auto_resize=' + resized + ', enveloppe_node=' + frameWraps + ')');
  if (moved && tracks && resized && frameWraps) console.log('OK drag interne: node bouge librement + cadre auto-resize en l\'enveloppant');
  else console.log('WARN drag interne: bouge=' + moved + ' suit=' + tracks + ' auto_resize=' + resized + ' enveloppe=' + frameWraps);

  // --- 3. Drag du CADRE -> tout le contenu suit ---
  await setMove();
  // Centre la vue sur le HAUT du cadre (barre de titre) pour qu'elle soit dans le viewport.
  const scNow = await rectOf('.node-wrap[data-kind="subcanvas"]');
  await centerWorld(scNow.x + 80, scNow.y + 60, 1);
  await p.waitForTimeout(400);
  const refBefore = await p.evaluate((id) => { const w = document.querySelector('.node-wrap[data-id="' + id + '"]'); return w ? { x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0 } : null; }, ed0Before.id);
  const scWrapBox = await (await p.$('.node-wrap[data-kind="subcanvas"]')).boundingBox();
  // grip dans la barre de titre : pres du HAUT, a ~40px du bord gauche (eviter le bouton repli a droite).
  const fStartX = scWrapBox.x + 40, fStartY = scWrapBox.y + 10;
  const FDX = -150, FDY = -80;
  await p.mouse.move(fStartX, fStartY); await p.mouse.down();
  await p.mouse.move(fStartX + FDX, fStartY + FDY, { steps: 12 }); await p.mouse.up();
  await p.waitForTimeout(800);
  const refAfter = await p.evaluate((id) => { const w = document.querySelector('.node-wrap[data-id="' + id + '"]'); return w ? { x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0 } : null; }, ed0Before.id);
  const wFDX = FDX / zoom, wFDY = FDY / zoom;
  const sdx = refAfter && refBefore ? refAfter.x - refBefore.x : 0;
  const sdy = refAfter && refBefore ? refAfter.y - refBefore.y : 0;
  const tolF = 60;
  const followX = refAfter && near(sdx, wFDX, Math.max(tolF, Math.abs(wFDX) * 0.30));
  const followY = refAfter && near(sdy, wFDY, Math.max(tolF, Math.abs(wFDY) * 0.30));
  console.log('  [cadre] delta_cible world=(' + Math.round(wFDX) + ',' + Math.round(wFDY) + ') contenu_bouge=(' + Math.round(sdx) + ',' + Math.round(sdy) + ')');
  if (followX && followY) console.log('OK drag cadre: le contenu suit');
  else console.log('WARN drag cadre: contenu=(' + Math.round(sdx) + ',' + Math.round(sdy) + ') cible=(' + Math.round(wFDX) + ',' + Math.round(wFDY) + ') followX=' + followX + ' followY=' + followY);

  await p.screenshot({ path: 'scripts/.pw/subcanvas-drag.png' });
  await clear();
  console.log('CONSOLE_ERRORS:', logs.length); logs.slice(0, 8).forEach((x) => console.log('  ', x));
  if (httpFails.length) { console.log('HTTP_FAILS:', httpFails.length); httpFails.slice(0, 8).forEach((x) => console.log('  ', x)); }
} catch (e) { console.error('FAIL', e); } finally { await b.close(); }
