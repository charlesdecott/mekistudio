// Valide F3a : lire un fichier NON ouvert -> spawn d'un éditeur éphémère (comète + fade-in) ;
// dedup ; survie au reload ; épingle au clic ; TTL -> disparition. Screenshots + console.
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

const editorsFor = (f) => p.evaluate((s) => [...document.querySelectorAll('.node-wrap[data-kind="fileeditor"]')].filter((w) => (w.dataset.file || '').includes(s)).length, f);
const ephFor = (f) => p.evaluate((s) => [...document.querySelectorAll('.node-wrap.ephemeral[data-kind="fileeditor"]')].filter((w) => (w.dataset.file || '').includes(s)).length, f);
const turnEnded = () => p.waitForFunction(() => { const sb = document.querySelector('.cmp-chat .chat-statusbar'); return !sb || sb.style.display === 'none'; }, null, { timeout: 120000 });
async function ask(text) {
  const ta = p.locator('.cmp-chat .chat-input').first();
  await ta.click(); await ta.fill(text); await ta.press('Enter');
}

const FILE = 'mekistudio/cli.py';      // fichier SANS éditeur ouvert
const FILE2 = 'mekistudio/__init__.py';
const out = {};
try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(1000);
  // le viewport persisté peut avoir dérivé (zoom/pan) -> on le réinitialise pour CENTRER le chat
  // (sinon le champ de saisie peut être hors de la fenêtre Playwright). Puis reload pour appliquer.
  const chat = await p.evaluate(() => { const w = document.querySelector('.node-wrap[data-kind="chat"]'); return w ? { x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0, w: w.offsetWidth, h: w.offsetHeight } : null; });
  if (chat) {
    const zoom = 0.35;
    const v = { x: Math.round(640 - (chat.x + chat.w / 2) * zoom), y: Math.round(360 - (chat.y + chat.h / 2) * zoom), zoom };
    await p.evaluate((vv) => fetch('/api/canvas/viewport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vv) }), v);
    await p.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
    await p.waitForTimeout(1500);
  }
  out.before = await editorsFor('cli.py');

  // 1. SPAWN
  await ask(`Avec l'outil Read, lis le fichier ${FILE}. Réponds en un mot.`);
  await p.waitForFunction(() => [...document.querySelectorAll('.node-wrap.ephemeral[data-kind="fileeditor"]')].some((w) => (w.dataset.file || '').includes('cli.py')), null, { timeout: 120000 })
    .catch(() => logs.push('[wait] spawn timeout'));
  await turnEnded().catch(() => {});
  await p.waitForTimeout(1500);
  out.spawnedEph = await ephFor('cli.py');
  await p.screenshot({ path: join(OUT, 'f3-1-spawn.png') });

  // 2. DEDUP
  await ask(`Relis ${FILE} avec Read.`);
  await turnEnded().catch(() => {});
  await p.waitForTimeout(1500);
  out.afterDedup = await editorsFor('cli.py');

  // 3. RELOAD : l'éphémère non expiré survit
  await p.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(2000);
  out.afterReload = await editorsFor('cli.py');
  out.ephAfterReload = await ephFor('cli.py');

  // 4. ÉPINGLE au clic (clic programmatique sur le wrap -> bubble vers le listener d'épingle)
  await p.evaluate(() => { const w = [...document.querySelectorAll('.node-wrap.ephemeral[data-kind="fileeditor"]')].find((x) => (x.dataset.file || '').includes('cli.py')); if (w) w.click(); });
  await p.waitForTimeout(1500);
  out.ephAfterPin = await ephFor('cli.py');
  out.stillThereAfterPin = await editorsFor('cli.py');
  await p.screenshot({ path: join(OUT, 'f3-2-pinned.png') });

  // 5. RELOAD après épingle : permanent survit
  await p.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(2000);
  out.afterPinReload = await editorsFor('cli.py');
  out.ephAfterPinReload = await ephFor('cli.py');

  // 6. TTL court -> disparition
  out.ttlSet = await p.evaluate(() => {
    for (const el of document.querySelectorAll('[x-data]')) {
      const d = window.Alpine && window.Alpine.$data(el);
      if (d && '_spawnTtlMs' in d) { d._spawnTtlMs = 2500; return true; }
    }
    return false;
  });
  await ask(`Avec Read, lis ${FILE2}.`);
  await p.waitForFunction(() => [...document.querySelectorAll('.node-wrap.ephemeral[data-kind="fileeditor"]')].some((w) => (w.dataset.file || '').includes('__init__')), null, { timeout: 120000 }).catch(() => logs.push('[wait] ttl spawn timeout'));
  out.ttlSpawned = await ephFor('__init__');
  await p.waitForTimeout(4000); // > TTL (2.5s)
  out.ttlGone = await editorsFor('__init__');

  console.log('RESULTS:', JSON.stringify(out, null, 0));
  const ok = out.spawnedEph >= 1 && out.afterDedup === 1 && out.afterReload === 1 && out.ephAfterReload === 1 &&
    out.ephAfterPin === 0 && out.stillThereAfterPin === 1 && out.afterPinReload === 1 && out.ephAfterPinReload === 0 &&
    out.ttlSpawned >= 1 && out.ttlGone === 0;
  console.log(ok ? '✅ PASS' : '❌ FAIL');
} catch (e) {
  console.log('SCRIPT-ERROR:', e.message);
  console.log('RESULTS:', JSON.stringify(out));
} finally {
  // cleanup : retire l'éditeur cli.py épinglé (laisser le canvas propre pour l'utilisateur)
  await p.evaluate(async () => {
    const w = [...document.querySelectorAll('.node-wrap[data-kind="fileeditor"]')].find((x) => (x.dataset.file || '').includes('cli.py'));
    if (w) { try { await fetch('/api/canvas/nodes/' + w.dataset.id, { method: 'DELETE' }); } catch (e) {} }
  }).catch(() => {});
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[wait'));
  console.log('CONSOLE_ERRORS/WAIT:', errs.length);
  errs.forEach((x) => console.log('  ', x));
  await b.close();
}
