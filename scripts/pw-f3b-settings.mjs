// Valide F3b : le node chat est configurable -> modale de réglages d'auto-spawn (mode/TTL/plafond) ;
// le réglage persiste, le front le lit, et le mode change le comportement du spawn :
//  capped   -> éditeur 'ephemeral' (aperçu) SANS TTL (expires_at_ms null)
//  unlimited -> éditeur PERMANENT (ephemeral false). Nettoie + remet 'ephemeral' à la fin.
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const logs = [];
const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const comp = () => p.evaluateHandle(() => { for (const el of document.querySelectorAll('[x-data]')) { const d = window.Alpine && window.Alpine.$data(el); if (d && d.spawnEphemeralEditor) return d; } return null; });
const canvasGet = () => p.evaluate(async () => (await (await fetch('/api/canvas')).json()).nodes);
const out = {};
try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(1200);

  // 1) engrenage du chat -> modale avec le formulaire d'auto-spawn
  await p.evaluate(() => { const g = document.querySelector('.node-wrap[data-kind="chat"] .node-gear'); if (g) g.click(); });
  await p.waitForTimeout(400);
  out.formVisible = await p.evaluate(() => { const f = document.querySelector('.chat-spawn-settings'); return !!f && !!f.querySelector('select') && !!f.querySelector('input[type="number"]'); });

  // 2) passe en 'capped' (cap 5) via le formulaire, enregistre
  await p.selectOption('.chat-spawn-settings select', 'capped').catch(() => logs.push('[sel] capped'));
  await p.locator('.chat-spawn-settings input[type="number"]:visible').first().fill('5').catch(() => logs.push('[fill] cap'));
  await p.click('.modal-foot .primary');
  await p.waitForTimeout(600);
  out.persistedCapped = await p.evaluate(async () => { const n = (await (await fetch('/api/canvas')).json()).nodes.find((x) => x.kind === 'chat'); const c = n.root.children[0].children[0]; return c.spawn_mode === 'capped' && c.spawn_cap === 5; });
  const c1 = await comp();
  out.frontMode = await c1.evaluate((d) => d._spawnMode);

  // 3) spawn en mode capped -> éditeur 'ephemeral' mais SANS TTL
  const c2 = await comp();
  await c2.evaluate(async (d) => { await d.spawnEphemeralEditor('mekistudio/cli.py'); });
  await p.waitForTimeout(800);
  const ed1 = (await canvasGet()).find((n) => n.kind === 'fileeditor' && (n.root.children?.[0]?.children?.[0]?.file_path || '') === 'mekistudio/cli.py');
  out.cappedEphemeral = !!ed1 && ed1.ephemeral === true && ed1.expires_at_ms === null;

  // 4) passe en 'unlimited' (via Alpine, rapide), spawn -> éditeur PERMANENT
  const c3 = await comp();
  await c3.evaluate(async (d) => { d.settingsKind = 'chat'; d.settingsMode = 'unlimited'; d.settingsCap = 5; d.settingsTtl = 10; d.settingsNode = { id: document.querySelector('.node-wrap[data-kind="chat"]').dataset.id, root: null, kind: 'chat' }; await d.saveSettings(); });
  const c4 = await comp();
  out.frontModeUnlimited = await c4.evaluate((d) => d._spawnMode);
  await c4.evaluate(async (d) => { await d.spawnEphemeralEditor('mekistudio/__init__.py'); });
  await p.waitForTimeout(800);
  const ed2 = (await canvasGet()).find((n) => n.kind === 'fileeditor' && (n.root.children?.[0]?.children?.[0]?.file_path || '') === 'mekistudio/__init__.py');
  out.unlimitedPermanent = !!ed2 && ed2.ephemeral === false;

  // nettoyage + remet le mode 'ephemeral'
  await p.evaluate(async () => {
    for (const n of (await (await fetch('/api/canvas')).json()).nodes) {
      const fp = n.kind === 'fileeditor' && (n.root.children?.[0]?.children?.[0]?.file_path || '');
      if (fp === 'mekistudio/cli.py' || fp === 'mekistudio/__init__.py') await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' });
      if (n.kind === 'chat') await fetch('/api/canvas/nodes/' + n.id + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spawn_mode: 'ephemeral', spawn_ttl_min: 10, spawn_cap: 20 }) });
    }
  });

  console.log('RESULT:', JSON.stringify(out));
  const ok = out.formVisible && out.persistedCapped && out.frontMode === 'capped' && out.cappedEphemeral && out.frontModeUnlimited === 'unlimited' && out.unlimitedPermanent;
  console.log(ok ? '✅ PASS — modale + persistance + le mode change le spawn' : '❌ FAIL');
} catch (e) { console.log('ERR', e.message); console.log('RESULT:', JSON.stringify(out)); }
finally { console.log('PAGEERRORS:', logs.length); logs.forEach((x) => console.log('  ', x)); await b.close(); }
