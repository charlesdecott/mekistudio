const test = require('node:test');
const assert = require('node:assert');
const G = require('./git-node.js');

test('fmtTitle : branche + détaché', () => {
  assert.equal(G.fmtTitle({ branch: 'main' }), '⎇ main');
  assert.equal(G.fmtTitle({ branch: 'HEAD', detached: true }), '⎇ HEAD (détaché)');
  assert.equal(G.fmtTitle({ branch: null }), '⎇ —');
  assert.equal(G.fmtTitle(null), '⎇ —');
});

test('fmtDetail : ahead/behind + modifs', () => {
  assert.equal(G.fmtDetail({ branch: 'main', ahead: 2, behind: 0, dirty: 3 }), '↑2 ↓0 · ● 3 modifs');
  assert.equal(G.fmtDetail({ branch: 'main', ahead: 0, behind: 0, dirty: 1 }), '↑0 ↓0 · ● 1 modif');
  assert.equal(G.fmtDetail({ branch: 'main', ahead: null, behind: null, dirty: 0 }), '✓ propre');
  assert.equal(G.fmtDetail({ branch: null }), 'pas un dépôt git');
});
