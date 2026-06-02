const test = require('node:test');
const assert = require('node:assert');
const MekiImpulses = require('./chat-impulses.js');

test('isAbsPath : Windows / posix / UNC absolus, relatifs non', () => {
  assert.equal(MekiImpulses.isAbsPath('C:\\mekistudio\\a.py'), true);
  assert.equal(MekiImpulses.isAbsPath('C:/mekistudio/a.py'), true);
  assert.equal(MekiImpulses.isAbsPath('/home/x/a.py'), true);
  assert.equal(MekiImpulses.isAbsPath('//srv/share/a.py'), true);
  assert.equal(MekiImpulses.isAbsPath('pkg/a/a.py'), false);
  assert.equal(MekiImpulses.isAbsPath('a.py'), false);
});

test('toRepoRel : chemin ABSOLU Windows -> relatif posix au repo (cœur du fix doublons)', () => {
  const root = 'C:\\mekistudio';
  assert.equal(MekiImpulses.toRepoRel('C:\\mekistudio\\pkg\\a\\file.py', root), 'pkg/a/file.py');
  assert.equal(MekiImpulses.toRepoRel('C:/mekistudio/pkg/a/file.py', root), 'pkg/a/file.py');
  // casse différente du préfixe racine (Windows insensible à la casse)
  assert.equal(MekiImpulses.toRepoRel('c:\\MekiStudio\\pkg\\a.py', root), 'pkg/a.py');
  // la racine elle-même -> ""
  assert.equal(MekiImpulses.toRepoRel('C:\\mekistudio', root), '');
});

test('toRepoRel : collapse les / multiples (parité serveur repo_relpath)', () => {
  // sans collapse, la clé front "pkg//a/f.py" ≠ clé serveur "pkg/a/f.py" -> doublons
  assert.equal(MekiImpulses.toRepoRel('C://mekistudio//pkg//a//f.py', 'C://mekistudio'), 'pkg/a/f.py');
  assert.equal(MekiImpulses.toRepoRel('pkg//a//f.py', 'C:/mekistudio'), 'pkg/a/f.py');
});

test('toRepoRel : déjà relatif -> normalisé (no-op), hors-repo -> renvoyé tel quel', () => {
  assert.equal(MekiImpulses.toRepoRel('pkg/a/file.py', 'C:\\mekistudio'), 'pkg/a/file.py');
  assert.equal(MekiImpulses.toRepoRel('./pkg/a/file.py', 'C:\\mekistudio'), 'pkg/a/file.py');
  assert.equal(MekiImpulses.toRepoRel('D:\\autre\\x.py', 'C:\\mekistudio'), 'D:/autre/x.py'); // hors-repo : reste absolu
  assert.equal(MekiImpulses.toRepoRel('a.py', ''), 'a.py'); // racine inconnue -> best-effort
});

test('tool_result Read réussi -> comète vers le fichier (fallback COMÈTE vers explorateur)', () => {
  const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Read', file_path: 'a.py' });
  assert.equal(i.kind, 'comet');
  assert.deepEqual(i.target, { by: 'file', value: 'a.py' });
  assert.equal(i.level, 'strong');
  // pas d'éditeur ouvert -> la comète VOYAGE quand même vers l'explorateur (pas un simple glow)
  assert.deepEqual(i.fallback, { kind: 'comet', target: { by: 'kind', value: 'fileexplorer' }, level: 'strong' });
});

test('tool_result Grep AVEC chemin (path enrichi) -> comète vers le fichier', () => {
  const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Grep', file_path: 'b.py' });
  assert.equal(i.kind, 'comet');
  assert.equal(i.target.value, 'b.py');
});

test('outil fichier SANS chemin précis (Grep repo-wide, Glob, LS) -> comète vers explorateur', () => {
  for (const name of ['Grep', 'Glob', 'LS']) {
    const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name }); // pas de file_path
    assert.deepEqual(i, { kind: 'comet', target: { by: 'kind', value: 'fileexplorer' }, level: 'soft' },
      `${name} sans chemin doit aller à l'explorateur`);
  }
});

test('Read sans file_path -> comète vers explorateur (au lieu de null)', () => {
  const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Read' });
  assert.deepEqual(i, { kind: 'comet', target: { by: 'kind', value: 'fileexplorer' }, level: 'soft' });
});

test('fileMatch : relatif, ./, absolu (suffixe de segments), backslashes', () => {
  assert.equal(MekiImpulses.fileMatch('a/b.py', 'a/b.py'), true);
  assert.equal(MekiImpulses.fileMatch('CLAUDE.md', './CLAUDE.md'), true);
  // éditeur relatif vs lecture en chemin ABSOLU windows -> match par suffixe de segments
  assert.equal(MekiImpulses.fileMatch('mekistudio/backend/chat/bridge.py', 'C:\\mekistudio\\mekistudio\\backend\\chat\\bridge.py'), true);
  // pas de faux positif sur une fin de segment partielle
  assert.equal(MekiImpulses.fileMatch('bridge.py', 'C:/x/zridge.py'), false);
  assert.equal(MekiImpulses.fileMatch('a/b.py', 'c/b.py'), false);
  assert.equal(MekiImpulses.fileMatch('', 'x'), false);
  assert.equal(MekiImpulses.fileMatch('x', ''), false);
});

test('tool_result en erreur -> flash rouge sur le chat', () => {
  const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: true, name: 'Read', file_path: 'x' });
  assert.deepEqual(i, { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'error' });
});

test('turn_end -> glow fort chat, dismissable', () => {
  const i = MekiImpulses.impulseFor({ type: 'turn_end', status: 'success' });
  assert.deepEqual(i, { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'strong', dismissable: true });
});

test('hook_fired Notification -> glow-notif chat, dismissable', () => {
  const i = MekiImpulses.impulseFor({ type: 'hook_fired', name: 'Notification', data: {} });
  assert.deepEqual(i, { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'notif', dismissable: true });
});

test('events sans impulsion -> null', () => {
  assert.equal(MekiImpulses.impulseFor({ type: 'hook_fired', name: 'PostToolUse', data: {} }), null);
  assert.equal(MekiImpulses.impulseFor({ type: 'tool_use', id: 'x' }), null);
  assert.equal(MekiImpulses.impulseFor({ type: 'message_stop' }), null);
  assert.equal(MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Bash' }), null); // outil non-lecture
  assert.equal(MekiImpulses.impulseFor(null), null);
});
