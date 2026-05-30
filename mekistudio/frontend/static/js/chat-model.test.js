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

// ORDRE LIVE RÉEL (vérifié par diag SDK) : message_start -> tool_use(s) -> tool_result(s) -> message_stop
// (les `assistant`/tool_use arrivent AVANT le message_stop du groupe). La bulle en vol porte les outils.
test('LIVE: tool_use pendant le groupe en vol -> carte rattachée à la bulle, tool_result la ferme', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 2, id: 'X', name: 'Read', input: { file_path: 'a.py' } });
  assert.equal(s.toolsById['X'].status, 'running');
  assert.ok(s.byId['m1'].tools.includes('X'));
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'X', output: '73 l.', is_error: false });
  s = MekiChat.reduce(s, { type: 'message_stop', message_id: 'm1', seq: 4, status: 'success' });
  assert.equal(s.toolsById['X'].status, 'done');
  assert.equal(s.toolsById['X'].output, '73 l.');
  assert.ok(s.byId['m1'].tools.includes('X'));
  // replay du même tool_result (même seq) -> idempotent
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'X', output: '73 l.', is_error: false });
  assert.equal(s.toolsById['X'].status, 'done');
});

test('LIVE: tool_result is_error -> status error', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 2, id: 'Y', name: 'Read', input: {} });
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'Y', output: 'interrompu', is_error: true });
  assert.equal(s.toolsById['Y'].status, 'error');
});

// ORDRE DURABLE RÉEL au REPLAY (pas de message_start transient) : les tool_use d'un groupe sont
// persistés AVANT l'assistant_message du groupe (seq(tool_use) < seq(assistant_message)). Le
// réducteur doit donc bufferiser les tool_use orphelins et les rattacher à la PROCHAINE bulle.
test('REPLAY: tool_use AVANT assistant_message -> cartes rattachées à la bulle du groupe', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'user_message', seq: 1, text: 'lis a b' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 2, id: 'A', name: 'Read', input: { file_path: 'a.py' } });
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'A', output: 'x', is_error: false });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 4, id: 'B', name: 'Read', input: { file_path: 'b.py' } });
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 5, id: 'B', output: 'y', is_error: false });
  s = MekiChat.reduce(s, { type: 'assistant_message', seq: 6, text: '', status: 'success' }); // bulle du groupe d'outils (texte vide)
  s = MekiChat.reduce(s, { type: 'assistant_message', seq: 7, text: 'Lecture faite', status: 'success' }); // réponse finale
  const asst = s.messages.filter((m) => m.kind === 'assistant');
  assert.equal(asst.length, 2);
  assert.deepEqual(asst[0].tools, ['A', 'B'], 'les 2 cartes rattachées à la bulle du groupe');
  assert.deepEqual(asst[1].tools, [], 'la réponse finale ne porte aucun outil');
  assert.equal(s.toolsById['A'].status, 'done');
  assert.equal(s.toolsById['B'].status, 'done');
});

test('REPLAY multi-groupes: chaque outil rattaché à SA bulle (pas à la précédente)', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'user_message', seq: 1, text: 'go' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 2, id: 'A', name: 'Read', input: {} });
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'A', output: 'okA', is_error: false });
  s = MekiChat.reduce(s, { type: 'assistant_message', seq: 4, text: 'étape1', status: 'success' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 5, id: 'B', name: 'Glob', input: {} });
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 6, id: 'B', output: 'okB', is_error: false });
  s = MekiChat.reduce(s, { type: 'assistant_message', seq: 7, text: 'étape2', status: 'success' });
  const a = s.messages.filter((m) => m.kind === 'assistant');
  assert.deepEqual(a[0].tools, ['A']);
  assert.deepEqual(a[1].tools, ['B']);
});

// Reconnexion EN PLEIN outil (WS tombe après tool_use, avant message_stop) : le tool_use (seq déjà
// vu) est exclu du replay (read_since strict >). dropInFlight doit GARDER la bulle porteuse d'outils
// (sinon la carte disparaît), et le serveur re-émet message_start{même id} -> reset en place.
test('reattach mi-outil: dropInFlight conserve la bulle porteuse d outils (carte non perdue)', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'user_message', seq: 1, text: 'lis' });
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 2, id: 'X', name: 'Read', input: {} });
  assert.ok(s.byId['m1'].tools.includes('X'));
  MekiChat.dropInFlight(s);
  assert.ok(s.byId['m1'], 'la bulle mi-outil est conservée');
  assert.ok(s.byId['m1'].tools.includes('X'));
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' }); // re-émis par le serveur (tour running)
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: '' });
  assert.ok(s.byId['m1'].tools.includes('X'), 'la carte X survit au reattach mi-outil');
});

// dropInFlight d'une bulle SANS outil : comportement inchangé (retirée, le replay durable la recrée).
test('dropInFlight d une bulle sans outil la retire (pas de doublon au replay)', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm2' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm2', text: 'AB' });
  MekiChat.dropInFlight(s);
  assert.equal(s.byId['m2'], undefined);
  assert.equal(s.lastAssistant, null, 'lastAssistant ne pointe pas une bulle supprimée');
});
