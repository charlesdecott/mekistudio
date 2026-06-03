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

test('solve : un enfant converge vers la distance-repos quand le ressort domine (VOID < repos)', () => {
  const zones = [
    { id: 'p', parentId: null, center: { x: 0, y: 0 }, radius: 60, pinned: true },
    { id: 'c', parentId: 'p', center: { x: 400, y: 0 }, radius: 40, pinned: false },
  ];
  // repos ressort = 60+40+GAP(40) = 140 ; min répulsion = 60+40+VOID(10) = 110 < 140 -> le ressort gagne
  const pos = Z.solve(zones, { iters: 400, VOID: 10, GAP: 40 });
  const rest = 60 + 40 + 40; // 140
  const d = Math.hypot(pos.get('c').x - pos.get('p').x, pos.get('c').y - pos.get('p').y);
  assert.ok(Math.abs(d - rest) < 8, 'distance ~ repos (' + rest + '), obtenu ' + d.toFixed(1));
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
  const sep = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
  for (let i = 0; i < boxes.length; i++) {
    assert.ok(sep(boxes[i], folderBox) >= 18 - 1, 'fichier ' + i + ' à >= gap de la tuile');
    for (let j = i + 1; j < boxes.length; j++) assert.ok(sep(boxes[i], boxes[j]) >= 18 - 1, 'fichiers ' + i + '/' + j + ' à >= gap');
  }
});

test('packAround : déterministe', () => {
  const c = { x: 0, y: 0 }, f = { w: 116, h: 108 }, files = [{ w: 150, h: 46 }, { w: 150, h: 46 }, { w: 150, h: 46 }];
  assert.deepEqual(Z.packAround(c, f, files), Z.packAround(c, f, files));
});

test('packAround : liste vide -> []', () => {
  assert.deepEqual(Z.packAround({ x: 0, y: 0 }, { w: 116, h: 108 }, []), []);
});

test('packOutward : fichiers en colonne VERS LE HAUT (cap -PI/2), étroits en x, empilés en y', () => {
  const out = Z.packOutward({ w: 116, h: 108 }, [{ w: 150, h: 46 }, { w: 150, h: 46 }, { w: 150, h: 46 }], -Math.PI / 2, { gap: 12 });
  assert.equal(out.length, 3);
  // cap vertical -> tous centrés en x (top-left = -w/2 = -75) ; y de plus en plus négatif (vers le haut)
  out.forEach((p) => assert.equal(p.x, -75, 'centré en x'));
  assert.ok(out[0].y < 0 && out[1].y < out[0].y && out[2].y < out[1].y, 'empilés vers le haut');
});

test('packOutward : cap horizontal -> fichiers alignés en x, centrés en y', () => {
  const out = Z.packOutward({ w: 116, h: 108 }, [{ w: 150, h: 46 }, { w: 150, h: 46 }], 0, { gap: 12 });
  out.forEach((p) => assert.equal(p.y, -23, 'centré en y (top = -h/2)'));
  assert.ok(out[1].x > out[0].x && out[0].x > 0, 'vers la droite, croissant');
});

test('packOutward : liste vide -> []', () => {
  assert.deepEqual(Z.packOutward({ w: 116, h: 108 }, [], 0), []);
});

test('freestAngle : liste vide -> 0', () => {
  assert.equal(Z.freestAngle([]), 0);
});

test('freestAngle : milieu du plus grand secteur libre', () => {
  const a = Z.freestAngle([0, Math.PI / 2]);
  assert.ok(Math.abs(a - (5 * Math.PI / 4)) < 1e-6, 'milieu du grand secteur, obtenu ' + a);
});

test('radialLayout : chaîne à enfant unique -> rayon DROIT vers l’extérieur (colinéaire, rayon croissant)', () => {
  const zones = [
    { id: 'root', parentId: null, radius: 50, pinned: true, center: { x: 0, y: 0 } },
    { id: 'a', parentId: 'root', radius: 40, pinned: false, center: { x: 0, y: 0 } },
    { id: 'b', parentId: 'a', radius: 30, pinned: false, center: { x: 0, y: 0 } },
  ];
  const pos = Z.radialLayout(zones, { gap: 40 });
  assert.equal(pos.get('a').x, pos.get('root').x, 'a colinéaire à la racine en x');
  assert.equal(pos.get('b').x, pos.get('a').x, 'b prolonge le même rayon (x identique)');
  assert.ok(Math.abs(pos.get('b').y) > Math.abs(pos.get('a').y), 'b plus loin que a');
});

test('radialLayout : fourche -> enfants séparés, du côté avant (pas en sens opposé)', () => {
  const zones = [
    { id: 'root', parentId: null, radius: 60, pinned: true, center: { x: 0, y: 0 } },
    { id: 'p', parentId: 'root', radius: 40, pinned: false, center: { x: 0, y: 0 } },
    { id: 'c1', parentId: 'p', radius: 30, pinned: false, center: { x: 0, y: 0 } },
    { id: 'c2', parentId: 'p', radius: 30, pinned: false, center: { x: 0, y: 0 } },
  ];
  const pos = Z.radialLayout(zones, { gap: 40, cone: 0.85 });
  const p = pos.get('p'), c1 = pos.get('c1'), c2 = pos.get('c2');
  assert.ok(c1.y < 0 && c2.y < 0, 'enfants du côté avant (haut)');
  assert.ok(Math.hypot(c1.x - c2.x, c1.y - c2.y) > 1, 'enfants séparés');
  assert.ok(Math.hypot(c1.x, c1.y) > Math.hypot(p.x, p.y), 'enfants plus loin que le parent');
});

test('radialLayout : déterministe', () => {
  const mk = () => ([
    { id: 'root', parentId: null, radius: 50, pinned: true, center: { x: 5, y: 7 } },
    { id: 'a', parentId: 'root', radius: 40, pinned: false, center: { x: 0, y: 0 } },
    { id: 'b', parentId: 'root', radius: 40, pinned: false, center: { x: 0, y: 0 } },
    { id: 'c', parentId: 'a', radius: 30, pinned: false, center: { x: 0, y: 0 } },
  ]);
  const p1 = Z.radialLayout(mk()), p2 = Z.radialLayout(mk());
  for (const id of ['root', 'a', 'b', 'c']) assert.deepEqual(p1.get(id), p2.get(id));
});

test('freestAngle : un seul occupé -> opposé', () => {
  const a = Z.freestAngle([0]);
  assert.ok(Math.abs(a - Math.PI) < 1e-6, 'opposé, obtenu ' + a);
});
