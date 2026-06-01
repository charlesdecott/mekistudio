const test = require('node:test');
const assert = require('node:assert');
const { layoutTree } = require('./tree-layout.js');

const OPTS = { col: 600, row: 500, rootX: 300, rootCy: 400 };

test('chaîne dossier->…->fichier = ligne horizontale (x croît, même centre vertical)', () => {
  const items = [
    { id: 'A', parent: 'EX', w: 300, h: 320, sortKey: '0a' },
    { id: 'B', parent: 'A', w: 300, h: 320, sortKey: '0a/b' },
    { id: 'C', parent: 'B', w: 520, h: 440, sortKey: '1a/b/c.md' },
  ];
  const pos = layoutTree(items, 'EX', OPTS);
  // x strictement croissant avec la profondeur
  assert.ok(pos.A.x < pos.B.x && pos.B.x < pos.C.x);
  assert.equal(pos.A.x, 300 + 600); // profondeur 1
  assert.equal(pos.C.x, 300 + 3 * 600); // profondeur 3
  // centres verticaux alignés (chaîne -> tout sur la même ligne)
  const cyA = pos.A.y + 320 / 2, cyB = pos.B.y + 320 / 2, cyC = pos.C.y + 440 / 2;
  assert.ok(Math.abs(cyA - cyB) < 0.01 && Math.abs(cyB - cyC) < 0.01);
  assert.ok(Math.abs(cyA - OPTS.rootCy) < 0.01); // centré sur la racine
});

test('bifurcation : 2 feuilles sous un dossier -> même colonne, empilées, parent centré', () => {
  const items = [
    { id: 'A', parent: 'EX', w: 300, h: 320, sortKey: '0a' },
    { id: 'B', parent: 'A', w: 520, h: 440, sortKey: '1a/b.md' },
    { id: 'C', parent: 'A', w: 520, h: 440, sortKey: '1a/c.md' },
  ];
  const pos = layoutTree(items, 'EX', OPTS);
  assert.equal(pos.B.x, pos.C.x);        // même profondeur -> même colonne
  assert.ok(pos.A.x < pos.B.x);          // parent à gauche
  const cyB = pos.B.y + 220, cyC = pos.C.y + 220, cyA = pos.A.y + 160;
  assert.ok(cyB < cyC);                   // empilées (B au-dessus de C)
  assert.ok(Math.abs(cyA - (cyB + cyC) / 2) < 0.01); // parent centré sur ses enfants
  assert.ok((cyC - cyB) >= OPTS.row - 0.01); // créneau >= row (pas de chevauchement)
});

test('dossiers AVANT fichiers (sortKey) puis ordre stable', () => {
  const items = [
    { id: 'file', parent: 'EX', w: 520, h: 440, sortKey: '1z.md' },
    { id: 'dir', parent: 'EX', w: 300, h: 320, sortKey: '0a' },
  ];
  const pos = layoutTree(items, 'EX', OPTS);
  // 'dir' (sortKey '0a') vient avant 'file' ('1z.md') -> plus haut
  assert.ok(pos.dir.y < pos.file.y);
});

test('ignore les items hors du sous-arbre de la racine', () => {
  const items = [{ id: 'X', parent: 'OTHER', w: 100, h: 100, sortKey: 'x' }];
  const pos = layoutTree(items, 'EX', OPTS);
  assert.equal(Object.keys(pos).length, 0);
});
