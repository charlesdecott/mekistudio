// Valide le BLOCKER de la revue brique D : après un RELOAD, les tool-cards rejouées (replay durable)
// doivent rester VISIBLES (orphan-buffering). Avant le fix : 0 carte après reload (orphelines).
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

const countCards = () => p.evaluate(() => document.querySelectorAll('.cmp-chat .chat-tool').length);
// cartes réellement rattachées à une bulle (rendues), pas juste en mémoire
const cardNames = () => p.evaluate(() =>
  [...document.querySelectorAll('.cmp-chat .chat-tool .chat-tool-head b')].map((e) => e.textContent));

try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(1500); // replay éventuel de la conv existante

  const ta = p.locator('.cmp-chat .chat-input').first();
  await ta.click();
  await ta.fill('Avec l\'outil Read, lis le fichier CLAUDE.md puis le fichier docs/ROADMAP.md. Ensuite réponds en UNE phrase.');
  await ta.press('Enter');

  // attendre l'apparition d'au moins 2 cartes (les 2 Read) + fin de tour (statusbar cachée)
  await p.waitForFunction(() => document.querySelectorAll('.cmp-chat .chat-tool').length >= 2, null, { timeout: 120000 })
    .catch((e) => logs.push('[wait-cards] ' + e.message));
  await p.waitForFunction(
    () => { const sb = document.querySelector('.cmp-chat .chat-statusbar'); return !sb || sb.style.display === 'none'; },
    null, { timeout: 120000 },
  ).catch(() => logs.push('[wait-done] timeout'));
  await p.waitForTimeout(1200);

  const liveCount = await countCards();
  const liveNames = await cardNames();
  await p.screenshot({ path: join(OUT, 'reload-1-live.png'), fullPage: false });

  // === RELOAD (le test du blocker) ===
  await p.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  // attendre que le replay reconstitue les cartes
  await p.waitForFunction(() => document.querySelectorAll('.cmp-chat .chat-tool').length > 0, null, { timeout: 15000 })
    .catch(() => logs.push('[wait-reload] aucune carte après reload'));
  await p.waitForTimeout(1500);

  const reloadCount = await countCards();
  const reloadNames = await cardNames();
  await p.screenshot({ path: join(OUT, 'reload-2-after.png'), fullPage: false });

  console.log('LIVE   cards:', liveCount, liveNames);
  console.log('RELOAD cards:', reloadCount, reloadNames);
  const ok = reloadCount >= 2 && reloadCount >= liveCount;
  console.log(ok ? '✅ PASS : cartes rejouées après reload' : '❌ FAIL : cartes perdues au reload (bug #1)');
} catch (e) {
  logs.push(`[script-error] ${e.message}`);
  await p.screenshot({ path: join(OUT, 'reload-error.png') }).catch(() => {});
} finally {
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[wait'));
  console.log('CONSOLE_ERRORS/WAIT:', errs.length);
  errs.forEach((e) => console.log('  ', e));
  await b.close();
}
