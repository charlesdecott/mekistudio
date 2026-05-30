const test = require('node:test');
const assert = require('node:assert');
const MekiChat = require('./chat-model.js');

test('live: deltas assemblés puis finalisés', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'user_message', seq: 1, ts: 0, text: 'hi' });
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'Bon' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'jour' });
  s = MekiChat.reduce(s, { type: 'message_stop', message_id: 'm1', seq: 2, status: 'success' });
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[1].text, 'Bonjour');
  assert.equal(s.messages[1].status, 'success');
  assert.equal(s.lastSeq, 2);
});

test('message_start est idempotent (double attach -> reset, pas de doublon)', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'AB' });
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' }); // reattach
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'AB' });
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].text, 'AB');
});

test('replay assistant_message + dédup par seq (replay puis live = bulle unique)', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'X' });
  s = MekiChat.reduce(s, { type: 'message_stop', message_id: 'm1', seq: 5, status: 'success' });
  s = MekiChat.reduce(s, { type: 'assistant_message', seq: 5, ts: 0, text: 'X', status: 'success' });
  assert.equal(s.messages.filter((m) => m.kind === 'assistant').length, 1);
});

test('dropInFlight retire la bulle en vol non finalisée puis le replay durable = bulle unique', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'AB' });
  assert.equal(s.messages.length, 1);
  MekiChat.dropInFlight(s);
  assert.equal(s.messages.length, 0);
  assert.equal(s.inFlight, null);
  s = MekiChat.reduce(s, { type: 'assistant_message', seq: 3, text: 'ABCD', status: 'success' });
  assert.equal(s.messages.filter((m) => m.kind === 'assistant').length, 1);
});

test('queued met à jour la file ; error crée une bulle', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'queued', items: [{ index: 0, text: 'a' }] });
  assert.deepEqual(s.queue, [{ index: 0, text: 'a' }]);
  s = MekiChat.reduce(s, { type: 'error', seq: 9, message: 'boom' });
  assert.equal(s.messages.at(-1).kind, 'error');
  assert.equal(s.lastSeq, 9);
});

test('tool_use crée une carte running rattachée à l étape, tool_result la ferme, dédup seq', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'message_stop', message_id: 'm1', seq: 1, status: 'success' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 2, id: 'X', name: 'Read', input: { file_path: 'a.py' } });
  assert.equal(s.toolsById['X'].status, 'running');
  assert.ok(s.messages.at(-1).tools.includes('X'));
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'X', output: '73 l.', is_error: false });
  assert.equal(s.toolsById['X'].status, 'done');
  assert.equal(s.toolsById['X'].output, '73 l.');
  // replay du même tool_result (même seq) -> idempotent
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'X', output: '73 l.', is_error: false });
  assert.equal(s.toolsById['X'].status, 'done');
});

test('tool_result is_error -> status error', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'message_stop', message_id: 'm1', seq: 1, status: 'success' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 2, id: 'Y', name: 'Read', input: {} });
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'Y', output: 'interrompu', is_error: true });
  assert.equal(s.toolsById['Y'].status, 'error');
});
