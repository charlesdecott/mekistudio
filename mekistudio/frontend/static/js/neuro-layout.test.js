const test = require('node:test');
const assert = require('node:assert');
const { layout } = require('./neuro-layout.js');

// arbre : EX -> {docs -> sp -> specs -> {foo,bar}}, {src -> {a->x, b->{y,z}}}, README(racine)
const ITEMS = [
  { id: 'docs', parent: 'EX', w: 112, h: 42, sortKey: '0docs' },
  { id: 'sp', parent: 'docs', w: 112, h: 42, sortKey: '0docs/sp' },
  { id: 'specs', parent: 'sp', w: 112, h: 42, sortKey: '0docs/sp/specs' },
  { id: 'foo', parent: 'specs', w: 98, h: 36, sortKey: '1foo' },
  { id: 'bar', parent: 'specs', w: 98, h: 36, sortKey: '1bar' },
  { id: 'src', parent: 'EX', w: 112, h: 42, sortKey: '0src' },
  { id: 'a', parent: 'src', w: 112, h: 42, sortKey: '0src/a' },
  { id: 'x', parent: 'a', w: 98, h: 36, sortKey: '1x' },
  { id: 'b', parent: 'src', w: 112, h: 42, sortKey: '0src/b' },
  { id: 'y', parent: 'b', w: 98, h: 36, sortKey: '1y' },
  { id: 'z', parent: 'b', w: 98, h: 36, sortKey: '1z' },
  { id: 'README', parent: 'EX', w: 98, h: 36, sortKey: '1README' },
];
const OPTS = { rootX: 0, rootY: 0, rootW: 132, rootH: 54, chaos: 0.25, length: 180, spread: 1.0 };

function boxes(pos) {
  const m = {};
  for (const it of ITEMS) { const p = pos[it.id]; if (p) m[it.id] = { x: p.x, y: p.y, w: it.w, h: it.h }; }
  return m;
}
function overlaps(bx, gap) {
  gap = gap || 0; const ids = Object.keys(bx); let n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const A = bx[ids[i]], B = bx[ids[j]];
    if (A.x < B.x + B.w - gap && B.x < A.x + A.w - gap && A.y < B.y + B.h - gap && B.y < A.y + A.h - gap) n++;
  }
  return n;
}

test('positionne tous les descendants (pas la racine)', () => {
  const pos = layout(ITEMS, 'EX', OPTS);
  assert.equal(Object.keys(pos).length, ITEMS.length);
  assert.ok(!('EX' in pos));
});

test('zéro recouvrement entre nodes après relaxation', () => {
  const pos = layout(ITEMS, 'EX', OPTS);
  assert.equal(overlaps(boxes(pos), 2), 0);
});

test('aucun node ne recouvre l\'explorateur (obstacle fixe au centre)', () => {
  const pos = layout(ITEMS, 'EX', OPTS);
  const ex = { x: -66, y: -27, w: 132, h: 54 };
  for (const id in pos) {
    const b = { x: pos[id].x, y: pos[id].y, w: 112, h: 42 };
    const ov = b.x < ex.x + ex.w && ex.x < b.x + b.w && b.y < ex.y + ex.h && ex.y < b.y + b.h;
    assert.ok(!ov, id + ' recouvre l\'explorateur');
  }
});

test('déterministe : même entrée -> mêmes positions', () => {
  assert.deepEqual(layout(ITEMS, 'EX', OPTS), layout(ITEMS, 'EX', OPTS));
});

test('enfants répartis AUTOUR du centre (pas tous dans la même direction)', () => {
  const pos = layout(ITEMS, 'EX', OPTS);
  const top = ['docs', 'src', 'README'].map((id) => Math.atan2(pos[id].y, pos[id].x));
  const spread = Math.max(...top) - Math.min(...top);
  assert.ok(spread > 1.0, 'les enfants directs doivent rayonner (spread angulaire ' + spread.toFixed(2) + ')');
});

test('la graine change la forme (variation)', () => {
  const a = layout(ITEMS, 'EX', OPTS);
  const b = layout(ITEMS, 'EX', Object.assign({}, OPTS, { seed: 7 }));
  let diff = 0; for (const id in a) if (Math.abs(a[id].x - b[id].x) > 1 || Math.abs(a[id].y - b[id].y) > 1) diff++;
  assert.ok(diff > 0, 'une autre graine doit donner une autre disposition');
});
