const test = require('node:test');
const assert = require('node:assert');
const MekiFolders = require('./folders.js');

test('dirOf : dossier du fichier (racine -> "")', () => {
  assert.equal(MekiFolders.dirOf('docs/superpowers/specs/foo.md'), 'docs/superpowers/specs');
  assert.equal(MekiFolders.dirOf('top.md'), '');
  assert.equal(MekiFolders.dirOf('./a/b.txt'), 'a');
});

test('ancestors : tous les préfixes-dossier, court -> long, sans racine', () => {
  assert.deepEqual(MekiFolders.ancestors('docs/superpowers/specs'), [
    'docs', 'docs/superpowers', 'docs/superpowers/specs',
  ]);
  assert.deepEqual(MekiFolders.ancestors(''), []);
});

test('desiredFolders plein : union des ancêtres', () => {
  const got = MekiFolders.desiredFolders(['docs/superpowers/specs/foo.md'], { compact: false });
  assert.deepEqual(got, ['docs', 'docs/superpowers', 'docs/superpowers/specs']);
});

test('desiredFolders : fichier à la racine -> aucun node dossier', () => {
  assert.deepEqual(MekiFolders.desiredFolders(['README.md'], { compact: false }), []);
});

test('desiredFolders compact : 1 fichier profond -> 1 seul node fusionné', () => {
  const got = MekiFolders.desiredFolders(['docs/superpowers/specs/foo.md'], { compact: true });
  assert.deepEqual(got, ['docs/superpowers/specs']);
});

test('desiredFolders compact : split au point de branchement', () => {
  const got = MekiFolders.desiredFolders(
    ['docs/superpowers/specs/foo.md', 'docs/IDEAS.md'],
    { compact: true },
  );
  // docs/ a un fichier direct (IDEAS.md) -> gardé ; superpowers/ fusionné ; specs/ gardé.
  assert.deepEqual(got, ['docs', 'docs/superpowers/specs']);
});

test('desiredFolders compact : deux branches sous un même parent -> parent gardé', () => {
  const got = MekiFolders.desiredFolders(
    ['src/a/x.py', 'src/b/y.py'],
    { compact: true },
  );
  // src/ a 2 enfants (a, b) -> point de branchement gardé ; a/ et b/ ont chacun un fichier.
  assert.deepEqual(got, ['src', 'src/a', 'src/b']);
});
