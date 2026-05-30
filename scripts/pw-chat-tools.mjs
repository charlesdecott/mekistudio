// Validation front des tool-cards (brique D) via Playwright.
// Lance un navigateur headless, capture la console, tape un prompt qui force un Read,
// attend la tool-card, prend des screenshots. Usage : node scripts/pw-chat-tools.mjs [url]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.pw');
mkdirSync(OUT, { recursive: true });

const logs = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

async function shot(name) {
  await page.screenshot({ path: join(OUT, name), fullPage: false });
  console.log('screenshot', name);
}

try {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await shot('01-loaded.png');

  const ta = page.locator('.cmp-chat .chat-input').first();
  await ta.click();
  await ta.fill('Combien de lignes contient le fichier CLAUDE.md ? Lis-le avec l\'outil Read.');
  await ta.press('Enter');

  // attend l'apparition d'une tool-card (bloc .chat-tools) — vraie session Claude
  await page.waitForSelector('.cmp-chat .chat-tools', { timeout: 90000 });
  await shot('02-tool-card.png');

  // attend la fin du tour (statusbar « Claude écrit… » masquée)
  await page.waitForFunction(
    () => { const sb = document.querySelector('.cmp-chat .chat-statusbar'); return !sb || sb.style.display === 'none'; },
    { timeout: 90000 },
  ).catch(() => {});
  await shot('03-done.png');

  // déplier la première tool-card pour vérifier la sortie
  await page.locator('.cmp-chat .chat-tool-head').first().click().catch(() => {});
  await shot('04-tool-expanded.png');

  const toolText = await page.locator('.cmp-chat .chat-tools').first().innerText().catch(() => '');
  console.log('TOOL_BLOCK:', JSON.stringify(toolText.slice(0, 200)));
} catch (e) {
  logs.push(`[script-error] ${e.message}`);
  await shot('99-error.png').catch(() => {});
} finally {
  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  writeFileSync(join(OUT, 'console.txt'), logs.join('\n'), 'utf-8');
  console.log('CONSOLE_ERRORS:', errors.length);
  errors.forEach((e) => console.log('  ', e));
  await browser.close();
}
