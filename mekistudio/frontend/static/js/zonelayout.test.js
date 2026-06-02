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
