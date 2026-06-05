// scripts/pw-terminal.mjs — valide la brique I : le node terminal (xterm.js) se monte, on
// tape `echo meki-e2e` + Entrée et la sortie apparaît ; au reload le scrollback est rejoué ;
// 0 erreur console. S'appuie sur un serveur de dev (port via argv, défaut 8799).
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const NEEDLE = 'meki-e2e';

const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: 1680, height: 950 });

const logs = [];
p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
p.on('pageerror', (e) => logs.push('PE:' + e.message));

const termText = () =>
  p.evaluate(() => {
    const r = document.querySelector('.cmp-terminal-host .xterm-rows');
    return r ? r.innerText.replace(/ /g, ' ') : '';
  });

const waitForText = async (needle, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = await termText();
    if (t.includes(needle)) return t;
    await p.waitForTimeout(250);
  }
  return await termText();
};

let ok = true;
const check = (cond, msg) => { console.log((cond ? 'OK  ' : 'FAIL ') + msg); if (!cond) ok = false; };

try {
  await p.goto(URL, { waitUntil: 'networkidle' });
  // le node terminal est built-in -> présent dès le boot
  await p.waitForSelector('.node-wrap[data-kind="terminal"]', { timeout: 10000 });
  // xterm monté (rAF différé) ?
  await p.waitForSelector('.cmp-terminal-host .xterm', { timeout: 10000 });
  check(true, 'node terminal rendu + xterm monté');

  // laisser le PTY PowerShell démarrer (prompt)
  await p.waitForTimeout(2500);

  // focus du terminal : clic sur le host puis focus du textarea caché d'xterm
  await p.click('.cmp-terminal-host');
  await p.waitForTimeout(200);
  const ta = await p.$('.cmp-terminal-host .xterm-helper-textarea');
  if (ta) await ta.focus();

  await p.keyboard.type('echo ' + NEEDLE);
  await p.keyboard.press('Enter');

  const after = await waitForText(NEEDLE);
  check(after.includes(NEEDLE), 'sortie `' + NEEDLE + '` visible après Entrée');
  await p.screenshot({ path: 'scripts/.pw/terminal.png' });

  // reload -> le scrollback persisté/bufferisé doit être rejoué
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.cmp-terminal-host .xterm', { timeout: 10000 });
  const replay = await waitForText(NEEDLE, 12000);
  check(replay.includes(NEEDLE), 'scrollback `' + NEEDLE + '` rejoué après reload');
  await p.screenshot({ path: 'scripts/.pw/terminal-reload.png' });

  check(logs.length === 0, 'aucune erreur console (' + logs.length + ')');
  if (logs.length) console.log('  ' + logs.slice(0, 8).join('\n  '));

  console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL');
} catch (e) {
  console.log('EXCEPTION: ' + e.message);
  console.log('console errors so far:\n  ' + logs.join('\n  '));
  ok = false;
} finally {
  await b.close();
}
process.exit(ok ? 0 : 1);
