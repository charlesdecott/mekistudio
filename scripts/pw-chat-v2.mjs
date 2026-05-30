// Validation Bug 1 (toutes les tool-cards) + Bug 2 (markdown) — SANS clic Nouvelle session.
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

const countTools = () => p.evaluate(() => document.querySelectorAll('.cmp-chat .chat-tool').length);
const mdInfo = () => p.evaluate(() => {
  const c = [...document.querySelectorAll('.cmp-chat .chat-content')];
  const html = c.map((e) => e.innerHTML);
  const withMd = html.filter((h) => /<(strong|em|ul|ol|li|code|h[1-6])\b/i.test(h));
  return { contentCount: c.length, mdCount: withMd.length, lastWithMd: withMd.length ? withMd[withMd.length - 1].slice(0, 200) : '' };
});

try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await p.waitForTimeout(2000); // laisse le replay de la conv se faire
  const before = await countTools();
  const md0 = await mdInfo();
  console.log('AVANT  tools:', before, '| markdown(existant):', md0);
  await p.screenshot({ path: join(OUT, 'v2-before.png'), fullPage: false });

  const ta = p.locator('.cmp-chat .chat-input').first();
  await ta.click();
  await ta.fill('Lis EXACTEMENT ces 3 fichiers avec Read: docs/ROADMAP.md, docs/IDEAS.md, docs/ARCHITECTURE.md. Puis réponds avec un **titre en gras** markdown et une liste à puces de 2 éléments.');
  await ta.press('Enter');

  await p.waitForFunction(
    (n) => document.querySelectorAll('.cmp-chat .chat-tool').length >= n + 3,
    before, { timeout: 120000 },
  ).catch((e) => logs.push('[wait] ' + e.message));
  await p.waitForFunction(
    () => { const sb = document.querySelector('.cmp-chat .chat-statusbar'); return !sb || sb.style.display === 'none'; },
    { timeout: 120000 },
  ).catch(() => {});
  await p.waitForTimeout(1500);
  await p.screenshot({ path: join(OUT, 'v2-after.png'), fullPage: false });

  const after = await countTools();
  const md1 = await mdInfo();
  console.log('APRES  tools:', after, '(+' + (after - before) + ')', '| markdown:', md1);
} catch (e) {
  logs.push(`[script-error] ${e.message}`);
  await p.screenshot({ path: join(OUT, 'v2-error.png') }).catch(() => {});
} finally {
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[wait]'));
  console.log('CONSOLE_ERRORS/WAIT:', errs.length);
  errs.forEach((e) => console.log('  ', e));
  await b.close();
}
