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

function segs(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    out.push({ dx: points[i].x - points[i - 1].x, dy: points[i].y - points[i - 1].y });
  }
  return out;
}

test('subwayPoints: exactement une diagonale 45° stricte, reste axis-aligned', () => {
  const A = { x: 100, y: 100 }, B = { x: 400, y: 220 };
  const pts = C.subwayPoints(A, 'right', B, 'left');
  const s = segs(pts);
  const diag = s.filter((g) => Math.abs(g.dx) > 0.001 && Math.abs(g.dy) > 0.001);
  assert.equal(diag.length, 1, 'une seule diagonale');
  assert.ok(Math.abs(Math.abs(diag[0].dx) - Math.abs(diag[0].dy)) < 0.001, '45° strict');
  // les autres segments sont horizontaux ou verticaux
  s.filter((g) => g !== diag[0]).forEach((g) => {
    assert.ok(Math.abs(g.dx) < 0.001 || Math.abs(g.dy) < 0.001);
  });
});

test('subwayPoints: run vertical dominant gère le 45° sans déborder', () => {
  const A = { x: 100, y: 100 }, B = { x: 140, y: 400 };
  const s = segs(C.subwayPoints(A, 'right', B, 'left'));
  const diag = s.filter((g) => Math.abs(g.dx) > 0.001 && Math.abs(g.dy) > 0.001);
  assert.equal(diag.length, 1);
  assert.ok(Math.abs(Math.abs(diag[0].dx) - Math.abs(diag[0].dy)) < 0.001);
});

test('pointsToPath: M..L.. uniquement, segments = points-1', () => {
  const d = C.pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]);
  assert.match(d, /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+)+$/);
  assert.equal((d.match(/L/g) || []).length, 2);
  assert.ok(!/[CQA]/.test(d), 'pas de courbe');
});

test('cableClass: paires connues + fallback neutre', () => {
  assert.equal(C.cableClass('fileexplorer', 'kernel'), 'k2e');
  assert.equal(C.cableClass('fileeditor', 'fileexplorer'), 'e2e');
  assert.equal(C.cableClass('chat', 'fileeditor'), 'cable-default');     // futur, non mappé
  assert.equal(C.cableClass('fileeditor', ''), 'cable-default');          // parent introuvable
});
