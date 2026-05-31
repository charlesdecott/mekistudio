const test = require('node:test');
const assert = require('node:assert');
const MekiImpulses = require('./chat-impulses.js');

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
