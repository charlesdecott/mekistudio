// Valide que la comète TRACE le câble progressivement (F3a) : spawn 1 éditeur, échantillonne le
// stroke-dasharray du nouveau câble pendant l'animation -> doit passer caché ('0 …') -> partiel
// ('>0 …', tracé derrière la comète) -> vide (câble complet). Screenshot mi-tracé. Puis nettoie.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.pw');
mkdirSync(OUT, { recursive: true });
const FILE = 'mekistudio/backend/bootstrap.py';
const logs = [];
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const dashFor = (f) => p.evaluate((s) => {
  const w = [...document.querySelectorAll('.node-wrap[data-kind="fileeditor"]')].find((x) => (x.dataset.file || '') === s);
  if (!w) return null;
  const g = document.querySelector('.world svg.cables g[data-edge="' + w.dataset.id + '"]');
  const core = g && g.querySelector('.cable-core');
  return core ? (core.style.strokeDasharray || '') : 'no-cable';
}, f);

try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(1500);

  // lance le spawn SANS l'attendre, pour échantillonner pendant l'animation
  await p.evaluate((f) => { let c; for (const el of document.querySelectorAll('[x-data]')) { const d = window.Alpine && window.Alpine.$data(el); if (d && d.spawnEphemeralEditor) { c = d; break; } } if (c) c.spawnEphemeralEditor(f); }, FILE);

  const samples = []; let shot = false;
  for (let i = 0; i < 80; i++) {
    const s = await dashFor(FILE);
    if (s !== null) samples.push(s);
    // screenshot quand le câble est en cours de tracé (premier nombre > 0) ; format "<n>, <m>"
    if (!shot && s && /^([\d.]+)[,\s]/.test(s) && parseFloat(s) > 0) { await p.screenshot({ path: join(OUT, 'cable-draw-mid.png') }); shot = true; }
    await p.waitForTimeout(70);
  }

  const hidden = samples.some((s) => /^0[,\s]/.test(s));
  const partial = samples.some((s) => { const m = /^([\d.]+)[,\s]/.exec(s); return m && parseFloat(m[1]) > 0; });
  const clearedAtEnd = samples.slice(-5).some((s) => s === '');

  // nettoyage
  await p.evaluate((f) => { const w = [...document.querySelectorAll('.node-wrap[data-kind="fileeditor"]')].find((x) => (x.dataset.file || '') === f); if (w) fetch('/api/canvas/nodes/' + w.dataset.id, { method: 'DELETE' }); }, FILE);

  console.log('dash samples (extrait):', JSON.stringify(samples.filter((s, i) => i % 3 === 0).slice(0, 16)));
  console.log('caché:', hidden, '| partiel (tracé):', partial, '| complet à la fin:', clearedAtEnd, '| screenshot mi-tracé:', shot);
  console.log(hidden && partial && clearedAtEnd ? '✅ PASS — la comète trace le câble progressivement' : '❌ FAIL');
} catch (e) { logs.push(`[script-error] ${e.message}`); console.log('ERR', e.message); }
finally {
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log('CONSOLE_ERRORS:', errs.length); errs.forEach((x) => console.log('  ', x));
  await b.close();
}
