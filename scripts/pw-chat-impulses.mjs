// Valide F1+F2 à fond : (1) la comète VOYAGE (circle.comet apparaît), (2) lire un fichier qui a un
// éditeur ouvert -> la comète atteint l'éditeur qui glow, (3) le glow de Stop PERSISTE jusqu'au clic,
// (4) reload ne rejoue PAS d'impulsion. Screenshots + console.
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

// Instrumentation (document-start) : compte impulsions + comètes (circle.comet) + éditeurs glowés.
await p.addInitScript(() => {
  window.__imp = 0; window.__comets = 0; window.__editorGlow = [];
  document.addEventListener('meki:impulse', () => { window.__imp++; });
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.getAttribute && (n.getAttribute('class') || '') === 'comet') window.__comets++;
        }
      } else if (m.type === 'attributes' && m.attributeName === 'class') {
        const t = m.target;
        if (t.dataset && t.dataset.kind === 'fileeditor' &&
            (t.classList.contains('glow-strong') || t.classList.contains('glow-soft'))) {
          window.__editorGlow.push(t.dataset.file || '?');
        }
      }
    }
  });
  mo.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
});

const turnStarted = () => p.waitForFunction(() => {
  const tools = document.querySelectorAll('.cmp-chat .chat-tool').length;
  const sb = document.querySelector('.cmp-chat .chat-statusbar');
  return tools >= 1 || (sb && sb.style.display !== 'none');
}, null, { timeout: 120000 });
const turnEnded = () => p.waitForFunction(() => {
  const sb = document.querySelector('.cmp-chat .chat-statusbar');
  return !sb || sb.style.display === 'none';
}, null, { timeout: 120000 });
const chatGlow = () => p.evaluate(() => {
  const w = document.querySelector('.node-wrap[data-kind="chat"]');
  return w ? w.className.includes('glow-strong') : false;
});

try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  const editorsWithFile = await p.evaluate(() =>
    [...document.querySelectorAll('.node-wrap[data-kind="fileeditor"]')].map((w) => w.dataset.file).filter(Boolean));
  await p.locator('.cmp-chat .chat-new').first().click(); // conversation fraîche -> live fiable
  await p.waitForTimeout(2500);
  const impBefore = await p.evaluate(() => window.__imp);

  const ta = p.locator('.cmp-chat .chat-input').first();
  await ta.click();
  await ta.fill('Avec l\'outil Read, lis le fichier CLAUDE.md. Puis réponds en un mot.');
  await ta.press('Enter');
  await turnStarted().catch(() => logs.push('[wait] start timeout'));
  await turnEnded().catch(() => logs.push('[wait] end timeout'));
  await p.waitForTimeout(2500); // laisse la comète finir d'animer

  const liveImpulses = (await p.evaluate(() => window.__imp)) - impBefore;
  const comets = await p.evaluate(() => window.__comets);
  const editorGlow = await p.evaluate(() => window.__editorGlow);
  const hookLines = await p.evaluate(() => document.querySelectorAll('.cmp-chat .chat-hook-line').length);
  const glowAfterTurn = await chatGlow();
  await p.screenshot({ path: join(OUT, 'imp-1-afterturn.png') });

  // (3) le glow de Stop doit PERSISTER (pas d'auto-fade)
  await p.waitForTimeout(3000);
  const glowPersists = await chatGlow();
  // ... puis s'éteindre au CLIC sur le node chat
  await p.locator('.node-wrap[data-kind="chat"] .chat-title').first().click();
  await p.waitForTimeout(400);
  const glowAfterClick = await chatGlow();
  await p.screenshot({ path: join(OUT, 'imp-2-afterclick.png') });

  // (4) reload : pas d'impulsion au replay
  await p.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(3000);
  const replayImpulses = await p.evaluate(() => window.__imp);

  console.log('éditeurs ouverts (data-file):', JSON.stringify(editorsWithFile));
  console.log('LIVE impulses:', liveImpulses, '| comètes (circle.comet):', comets, '| hook lines:', hookLines);
  console.log('éditeurs glowés:', JSON.stringify(editorGlow));
  console.log('glow chat après tour:', glowAfterTurn, '| persiste +3s:', glowPersists, '| après clic:', glowAfterClick);
  console.log('REPLAY impulses après reload (doit rester 0):', replayImpulses);
  const ok = liveImpulses >= 2 && comets >= 1 && hookLines >= 1 &&
    glowAfterTurn && glowPersists && !glowAfterClick && replayImpulses === 0;
  console.log(ok ? '✅ PASS' : '❌ FAIL');
} catch (e) {
  logs.push(`[script-error] ${e.message}`);
} finally {
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[wait'));
  console.log('CONSOLE_ERRORS/WAIT:', errs.length);
  errs.forEach((x) => console.log('  ', x));
  await b.close();
}
