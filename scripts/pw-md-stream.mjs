// Vérifie le markdown LIVE : présence de balises markdown PENDANT le streaming (statusbar visible).
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
const ta = p.locator('.cmp-chat .chat-input').first();
await ta.click();
await ta.fill('Réponds UNIQUEMENT avec du markdown détaillé: un **titre en gras**, puis une liste à puces de 4 éléments d\'une phrase chacun. Ne lis aucun fichier.');
await ta.press('Enter');

let sawMdWhileStreaming = false;
for (let i = 0; i < 150; i++) {
  const s = await p.evaluate(() => {
    const sb = document.querySelector('.cmp-chat .chat-statusbar');
    const streaming = !!(sb && sb.style.display !== 'none');
    const c = [...document.querySelectorAll('.cmp-chat .chat-content')];
    const last = c.length ? c[c.length - 1].innerHTML : '';
    return { streaming, hasMd: /<(strong|ul|ol|li|em|code)\b/i.test(last), len: last.length, hasCursor: /chat-cursor/.test(last) };
  });
  if (s.streaming && s.hasMd) sawMdWhileStreaming = true;
  if (!s.streaming && i > 5 && s.len > 0) break;
  await p.waitForTimeout(120);
}
console.log('sawMarkdownWhileStreaming:', sawMdWhileStreaming);
console.log('pageErrors:', errs.length, errs.slice(0, 3));
await b.close();
