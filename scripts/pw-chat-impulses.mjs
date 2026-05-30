// Valide F1+F2 : un tour réel déclenche des impulsions (comète/glow) + remplit le volet hooks ;
// le reload ne rejoue PAS les impulsions (marqueur attached -> live only). Screenshots + console.
// NB : on CLEAR d'abord (conversation fraîche) -> attached rapide, mesure fiable.
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

// compte les meki:impulse (initScript -> survit au reload, repart de 0 à chaque navigation)
await p.addInitScript(() => { window.__imp = 0; document.addEventListener('meki:impulse', () => { window.__imp++; }); });

const turnStarted = () => p.waitForFunction(() => {
  const tools = document.querySelectorAll('.cmp-chat .chat-tool').length;
  const sb = document.querySelector('.cmp-chat .chat-statusbar');
  return tools >= 1 || (sb && sb.style.display !== 'none');
}, null, { timeout: 120000 });
const turnEnded = () => p.waitForFunction(() => {
  const sb = document.querySelector('.cmp-chat .chat-statusbar');
  return !sb || sb.style.display === 'none';
}, null, { timeout: 120000 });

try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  // conversation FRAÎCHE -> replay vide -> attached quasi immédiat -> live=true fiable
  await p.locator('.cmp-chat .chat-new').first().click();
  await p.waitForTimeout(2500);
  const impBeforeTurn = await p.evaluate(() => window.__imp); // doit rester ~0

  const ta = p.locator('.cmp-chat .chat-input').first();
  await ta.click();
  await ta.fill('Avec l\'outil Read, lis CLAUDE.md. Puis réponds en un mot.');
  await ta.press('Enter');
  await turnStarted().catch(() => logs.push('[wait] start timeout'));
  await turnEnded().catch(() => logs.push('[wait] end timeout'));
  await p.waitForTimeout(2000);

  const liveImpulses = (await p.evaluate(() => window.__imp)) - impBeforeTurn;
  const hookLines = await p.evaluate(() => document.querySelectorAll('.cmp-chat .chat-hook-line').length);
  await p.screenshot({ path: join(OUT, 'impulses-1-live.png') });

  // RELOAD : le replay durable ne doit PAS redéclencher d'impulsions (live=false jusqu'à attached)
  await p.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(3000);
  const replayImpulses = await p.evaluate(() => window.__imp);
  await p.screenshot({ path: join(OUT, 'impulses-2-reload.png') });

  console.log('impulses avant tour (≈0):', impBeforeTurn);
  console.log('LIVE impulses:', liveImpulses, '| hook lines:', hookLines);
  console.log('REPLAY impulses après reload (doit rester 0):', replayImpulses);
  const ok = liveImpulses >= 2 && hookLines >= 1 && replayImpulses === 0;
  console.log(ok ? '✅ PASS' : '❌ FAIL');
} catch (e) {
  logs.push(`[script-error] ${e.message}`);
} finally {
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[wait'));
  console.log('CONSOLE_ERRORS/WAIT:', errs.length);
  errs.forEach((x) => console.log('  ', x));
  await b.close();
}
