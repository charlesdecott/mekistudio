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
