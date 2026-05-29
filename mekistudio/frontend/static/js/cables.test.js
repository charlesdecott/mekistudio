const test = require('node:test');
const assert = require('node:assert');
const C = require('./cables.js');

const box = (x, y, w, h) => ({ x, y, w, h });

test('adaptiveSide: axe dominant + tie horizontal', () => {
  const a = box(0, 0, 100, 100);
  assert.equal(C.adaptiveSide(a, box(300, 0, 100, 100)), 'right');
  assert.equal(C.adaptiveSide(a, box(-300, 0, 100, 100)), 'left');
  assert.equal(C.adaptiveSide(a, box(0, 300, 100, 100)), 'bottom');
  assert.equal(C.adaptiveSide(a, box(0, -300, 100, 100)), 'top');
  // tie |dx|==|dy| -> horizontal
  assert.equal(C.adaptiveSide(a, box(200, 200, 100, 100)), 'right');
});

test('sideAnchor: point sur la face + clamp sur la longueur du côté', () => {
  const b = box(0, 0, 100, 40);
  assert.deepEqual(C.sideAnchor(b, 'right', 0), { x: 100, y: 20 });
  assert.deepEqual(C.sideAnchor(b, 'left', 0), { x: 0, y: 20 });
  // offset énorme -> clampé sur la face (hauteur 40, marge 10 -> +-10 max)
  assert.equal(C.sideAnchor(b, 'right', 999).y, 30);
  assert.equal(C.sideAnchor(b, 'right', -999).y, 10);
});

test('assignLanes: offsets centrés, triés par le voisin, gap clampé, jamais égaux', () => {
  const box = (x, y, w, h) => ({ x, y, w, h });
  const node = box(0, 0, 100, 300); // côté droit long
  // 3 voisins dans le désordre vertical -> lanes triées de haut en bas
  const cables = [
    { neighbor: box(400, 200, 50, 50) },
    { neighbor: box(400, 0, 50, 50) },
    { neighbor: box(400, 100, 50, 50) },
  ];
  const offs = C.assignLanes(cables, node, 'right');
  // l'entrée du voisin le plus haut (y=0, index 1) doit avoir l'offset le plus négatif
  assert.ok(offs[1] < offs[2] && offs[2] < offs[0]);
  // centrés autour de 0
  assert.ok(Math.abs(offs[0] + offs[1] + offs[2]) < 1e-9);
  // 2 lanes ne partagent jamais la même valeur
  assert.equal(new Set(offs).size, 3);
  // 1 seul câble -> offset 0
  assert.deepEqual(C.assignLanes([{ neighbor: box(400, 0, 10, 10) }], node, 'right'), [0]);
});
