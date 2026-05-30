const test = require('node:test');
const assert = require('node:assert');
const MekiImpulses = require('./chat-impulses.js');

test('tool_result Read réussi -> comète vers le fichier (fallback glow explorateur)', () => {
  const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Read', file_path: 'a.py' });
  assert.equal(i.kind, 'comet');
  assert.deepEqual(i.target, { by: 'file', value: 'a.py' });
  assert.equal(i.level, 'strong');
  assert.deepEqual(i.fallback, { kind: 'glow', target: { by: 'kind', value: 'fileexplorer' }, level: 'soft' });
});

test('tool_result Grep réussi -> comète vers le fichier', () => {
  const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Grep', file_path: 'b.py' });
  assert.equal(i.kind, 'comet');
  assert.equal(i.target.value, 'b.py');
});

test('tool_result Glob / LS -> glow doux explorateur', () => {
  for (const name of ['Glob', 'LS']) {
    const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name });
    assert.deepEqual(i, { kind: 'glow', target: { by: 'kind', value: 'fileexplorer' }, level: 'soft' });
  }
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
  assert.equal(MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Read' }), null); // pas de file_path
  assert.equal(MekiImpulses.impulseFor(null), null);
});
