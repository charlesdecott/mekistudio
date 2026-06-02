const test = require('node:test');
const assert = require('node:assert');
const T = require('./territories.js');

test('convexHull : carré (les points intérieurs sont éliminés)', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    { x: 5, y: 5 }, // intérieur -> hors hull
  ];
  const hull = T.convexHull(pts);
  assert.equal(hull.length, 4);
  assert.ok(!hull.some((p) => p.x === 5 && p.y === 5));
});

test('convexHull : points alignés/dupliqués -> ≤ 2 sommets', () => {
  assert.equal(T.convexHull([{ x: 1, y: 1 }, { x: 1, y: 1 }]).length, 1);
  assert.equal(T.convexHull([{ x: 0, y: 0 }, { x: 2, y: 2 }]).length, 2);
});

test('boxCorners : 4 coins dans le bon ordre', () => {
  const c = T.boxCorners({ x: 0, y: 0, w: 4, h: 2 });
  assert.deepEqual(c, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }]);
});

test('roundedHullPath : chemin SVG fermé non vide pour 1 boîte', () => {
  const pts = T.boxCorners({ x: 100, y: 100, w: 200, h: 120 });
  const d = T.roundedHullPath(pts, 26);
  assert.match(d, /^M /);
  assert.match(d, /Z$/);
  assert.ok(d.includes('C')); // lissé en cubiques
});

test('roundedHullPath : le blob DILATE englobe les boîtes (déborde des extrêmes)', () => {
  const pts = T.boxCorners({ x: 0, y: 0, w: 100, h: 100 });
  const d = T.roundedHullPath(pts, 30);
  // extrait les coordonnées numériques du path
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...xs) < 0, 'déborde à gauche'); // dilaté au-delà de x=0
  assert.ok(Math.max(...xs) > 100, 'déborde à droite');
  assert.ok(Math.min(...ys) < 0 && Math.max(...ys) > 100);
});

test('roundedHullPath : liste vide -> chaîne vide', () => {
  assert.equal(T.roundedHullPath([], 26), '');
});

test('nearCorners : retourne les 2 coins côté `toward`', () => {
  const box = { x: 100, y: 0, w: 20, h: 20 }; // à droite ; parent à gauche (x=0)
  const near = T.nearCorners(box, { x: 0, y: 10 });
  // les coins proches du parent sont à x=100 (bord gauche de la boîte)
  assert.ok(near.every((p) => p.x === 100));
});

test('convexPolysIntersect : carrés disjoints / chevauchants', () => {
  const sq = (x) => [{ x, y: 0 }, { x: x + 10, y: 0 }, { x: x + 10, y: 10 }, { x, y: 10 }];
  assert.equal(T.convexPolysIntersect(sq(0), sq(20)), false); // vide entre eux
  assert.equal(T.convexPolysIntersect(sq(0), sq(5)), true);   // se recouvrent
  assert.equal(T.convexPolysIntersect(sq(0), sq(11)), false); // se frôlent à peine -> séparés
});

test('dilate : offset d arête -> impose le VIDE réel (gap 40px)', () => {
  const sq = (x) => [{ x, y: 0 }, { x: x + 20, y: 0 }, { x: x + 20, y: 20 }, { x, y: 20 }];
  const A = sq(0), B = sq(60); // bord droit de A en x=20, bord gauche de B en x=60 -> 40px de vide
  assert.equal(T.convexPolysIntersect(A, B), false);               // bruts : disjoints
  assert.equal(T.convexPolysIntersect(T.dilate(A, 30), B), false); // +30 < 40 de vide -> toujours disjoints
  assert.equal(T.convexPolysIntersect(T.dilate(A, 50), B), true);  // +50 > 40 -> se chevauchent (vide insuffisant)
});

test('convexPolysIntersect : polygone dégénéré (<3 pts) -> false', () => {
  assert.equal(T.convexPolysIntersect([{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]), false);
});
