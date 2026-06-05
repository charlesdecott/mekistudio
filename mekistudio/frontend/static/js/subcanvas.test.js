const test = require('node:test');
const assert = require('node:assert');
const S = require('./subcanvas.js');

test('descendants : chaîne + fourche, exclut la racine et les étrangers', () => {
  const links = [
    { id: 'sc', source: 'git' },
    { id: 'exp', source: 'sc' },
    { id: 'f1', source: 'exp' },
    { id: 'e1', source: 'f1' },
    { id: 'e2', source: 'exp' },
    { id: 'chat', source: 'git' }, // étranger (hors sous-arbre)
  ];
  const d = new Set(S.descendants(links, 'sc'));
  assert.ok(d.has('exp') && d.has('f1') && d.has('e1') && d.has('e2'));
  assert.ok(!d.has('sc'));   // exclut la racine
  assert.ok(!d.has('chat')); // exclut les étrangers
  assert.equal(d.size, 4);
});

test('descendants : racine sans enfant -> vide ; tolère un parent manquant', () => {
  assert.deepEqual(S.descendants([{ id: 'a', source: 'x' }], 'sc'), []);
});

test('derivedBounds : englobe toutes les boîtes + padding + bande de titre en haut', () => {
  const boxes = [
    { x: 100, y: 100, w: 50, h: 40 },
    { x: 300, y: 260, w: 60, h: 30 },
  ];
  const b = S.derivedBounds(boxes, { pad: 24, titleH: 26 });
  // englobe à droite/bas avec pad
  assert.ok(b.x <= 100 - 24 + 0.001 && b.y <= 100 - 24 - 26 + 0.001);
  assert.ok(b.x + b.w >= 360 + 24 - 0.001);
  assert.ok(b.y + b.h >= 290 + 24 - 0.001);
  // bande de titre : le haut remonte de titleH au-delà du pad
  assert.equal(Math.round(b.y), 100 - 24 - 26);
});

test('derivedBounds : aucune boîte -> null', () => {
  assert.equal(S.derivedBounds([], {}), null);
});
