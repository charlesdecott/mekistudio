// Vérifie que les libs vendored exposent bien window.marked / window.DOMPurify (Bug 2 markdown).
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('about:blank');
await p.addScriptTag({ path: 'mekistudio/frontend/static/vendor/marked.min.js' });
await p.addScriptTag({ path: 'mekistudio/frontend/static/vendor/purify.min.js' });
const r = await p.evaluate(() => ({
  marked: typeof window.marked,
  markedParse: typeof (window.marked && window.marked.parse),
  markedIsFn: typeof window.marked === 'function',
  dompurify: typeof window.DOMPurify,
  sanitize: typeof (window.DOMPurify && window.DOMPurify.sanitize),
  sample: (window.marked && window.DOMPurify && window.DOMPurify.sanitize)
    ? window.DOMPurify.sanitize((window.marked.parse || window.marked)('**bold** _i_\n\n- a\n- b'))
    : 'N/A',
}));
console.log(JSON.stringify(r, null, 2));
await b.close();
