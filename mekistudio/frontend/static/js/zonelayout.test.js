const test = require('node:test');
const assert = require('node:assert');
const Z = require('./zonelayout.js');

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('solve : deux zones qui se chevauchent sont écartées d\'au moins VOID', () => {
  const zones = [
    { id: 'a', parentId: null, center: { x: 0, y: 0 }, radius: 50, pinned: false },
    { id: 'b', parentId: null, center: { x: 20, y: 0 }, radius: 50, pinned: false },
  ];
  const pos = Z.solve(zones, { iters: 120, VOID: 60, GAP: 40 });
  const d = dist(pos.get('a'), pos.get('b'));
  assert.ok(d >= 50 + 50 + 60 - 1, 'écart >= r1+r2+VOID, obtenu ' + d.toFixed(1));
});

test('solve : une zone pinned ne bouge pas', () => {
  const zones = [
    { id: 'root', parentId: null, center: { x: 0, y: 0 }, radius: 80, pinned: true },
    { id: 'a', parentId: 'root', center: { x: 10, y: 0 }, radius: 50, pinned: false },
  ];
  const pos = Z.solve(zones, { iters: 120 });
  assert.deepEqual(pos.get('root'), { x: 0, y: 0 });
});

test('solve : un enfant est tiré vers la distance-repos de son parent', () => {
  const zones = [
    { id: 'p', parentId: null, center: { x: 0, y: 0 }, radius: 60, pinned: true },
    { id: 'c', parentId: 'p', center: { x: 400, y: 0 }, radius: 40, pinned: false },
  ];
  const pos = Z.solve(zones, { iters: 200, VOID: 60, GAP: 40 });
  const rest = 60 + 40 + 40;
  const d = dist(pos.get('p'), pos.get('c'));
  assert.ok(Math.abs(d - rest) < 25, 'distance ~ repos (' + rest + '), obtenu ' + d.toFixed(1));
});

test('solve : déterministe (mêmes entrées -> mêmes sorties)', () => {
  const mk = () => ([
    { id: 'a', parentId: null, center: { x: 0, y: 0 }, radius: 50, pinned: false },
    { id: 'b', parentId: null, center: { x: 10, y: 5 }, radius: 50, pinned: false },
    { id: 'c', parentId: 'a', center: { x: -10, y: 0 }, radius: 30, pinned: false },
  ]);
  const p1 = Z.solve(mk(), { iters: 80 }), p2 = Z.solve(mk(), { iters: 80 });
  for (const id of ['a', 'b', 'c']) assert.deepEqual(p1.get(id), p2.get(id));
});

test('solve : centres confondus -> séparés de façon déterministe', () => {
  const zones = [
    { id: 'a', parentId: null, center: { x: 0, y: 0 }, radius: 40, pinned: false },
    { id: 'b', parentId: null, center: { x: 0, y: 0 }, radius: 40, pinned: false },
  ];
  const pos = Z.solve(zones, { iters: 120, VOID: 60 });
  assert.ok(dist(pos.get('a'), pos.get('b')) > 1, 'séparés');
});

test('packAround : aucun fichier ne chevauche la tuile ni un autre fichier', () => {
  const center = { x: 500, y: 500 };
  const folder = { w: 116, h: 108 };
  const files = Array.from({ length: 6 }, () => ({ w: 150, h: 46 }));
  const out = Z.packAround(center, folder, files, { gap: 18 });
  assert.equal(out.length, 6, 'tous les fichiers placés');
  const boxes = out.map((p, i) => ({ x: p.x, y: p.y, w: files[i].w, h: files[i].h }));
  const folderBox = { x: center.x - folder.w / 2, y: center.y - folder.h / 2, w: folder.w, h: folder.h };
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (let i = 0; i < boxes.length; i++) {
    assert.ok(!hit(boxes[i], folderBox), 'fichier ' + i + ' ne touche pas la tuile');
    for (let j = i + 1; j < boxes.length; j++) assert.ok(!hit(boxes[i], boxes[j]), 'fichiers ' + i + '/' + j + ' disjoints');
  }
});

test('packAround : déterministe', () => {
  const c = { x: 0, y: 0 }, f = { w: 116, h: 108 }, files = [{ w: 150, h: 46 }, { w: 150, h: 46 }, { w: 150, h: 46 }];
  assert.deepEqual(Z.packAround(c, f, files), Z.packAround(c, f, files));
});

test('packAround : liste vide -> []', () => {
  assert.deepEqual(Z.packAround({ x: 0, y: 0 }, { w: 116, h: 108 }, []), []);
});

test('freestAngle : liste vide -> 0', () => {
  assert.equal(Z.freestAngle([]), 0);
});

test('freestAngle : milieu du plus grand secteur libre', () => {
  const a = Z.freestAngle([0, Math.PI / 2]);
  assert.ok(Math.abs(a - (5 * Math.PI / 4)) < 1e-6, 'milieu du grand secteur, obtenu ' + a);
});

test('freestAngle : un seul occupé -> opposé', () => {
  const a = Z.freestAngle([0]);
  assert.ok(Math.abs(a - Math.PI) < 1e-6, 'opposé, obtenu ' + a);
});
