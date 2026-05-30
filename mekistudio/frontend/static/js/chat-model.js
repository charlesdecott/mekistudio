// Réducteur PUR du chat : transforme un flux d'events wire en une liste de messages.
// Zéro DOM -> testable via `node --test` (invariant de pureté, comme cables.js/collision.js).
// Deux chemins produisent la même bulle assistant : live (message_start/text_delta/message_stop)
// et replay (assistant_message durable) ; la dédup par `seq` garantit une bulle unique.
(function (root) {
  'use strict';

  function createState() {
    return {
      messages: [], byId: {}, bySeq: {}, inFlight: null, lastSeq: 0, queue: [], state: 'idle',
      toolsById: {},        // brique D : cartes d'outils, appariées par tool_use_id
      lastAssistant: null,  // bulle assistant courante (étape) à laquelle rattacher les outils
    };
  }

  function _bumpSeq(state, seq) {
    if (typeof seq === 'number' && seq > state.lastSeq) state.lastSeq = seq;
  }

  function reduce(state, ev) {
    switch (ev.type) {
      case 'user_message': {
        if (ev.seq && state.bySeq[ev.seq]) break;
        const m = { kind: 'user', text: ev.text, ts: ev.ts, status: 'final', seq: ev.seq };
        state.messages.push(m);
        if (ev.seq) state.bySeq[ev.seq] = m;
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'message_start': {
        let m = state.byId[ev.message_id];
        if (!m) {
          m = { kind: 'assistant', message_id: ev.message_id, text: '', status: 'streaming', tools: [] };
          state.byId[ev.message_id] = m;
          state.messages.push(m);
        } else {
          // reattach : on RÉINITIALISE (le rattrapage renvoie le texte complet) -> pas de doublon
          m.text = '';
          m.status = 'streaming';
        }
        state.inFlight = m;
        state.lastAssistant = m;  // les tool_use suivants se rattachent à cette étape
        break;
      }
      case 'text_delta': {
        const m = state.byId[ev.message_id];
        if (m) m.text += ev.text;
        break;
      }
      case 'message_stop': {
        const m = state.byId[ev.message_id];
        if (m) {
          m.status = ev.status;
          m.seq = ev.seq;
          if (ev.seq) state.bySeq[ev.seq] = m;
        }
        state.inFlight = null;
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'assistant_message': {
        // chemin REPLAY : record durable. Dédup par seq avec le chemin live.
        if (ev.seq && state.bySeq[ev.seq]) {
          _bumpSeq(state, ev.seq);
          break;
        }
        const m = { kind: 'assistant', text: ev.text, status: ev.status, seq: ev.seq, tools: [] };
        state.messages.push(m);
        if (ev.seq) state.bySeq[ev.seq] = m;
        state.lastAssistant = m;  // chemin REPLAY : rattacher les tool_use rejoués à cette étape
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'tool_use': {
        if (ev.seq && state.bySeq[ev.seq]) { _bumpSeq(state, ev.seq); break; }
        state.toolsById[ev.id] = { id: ev.id, name: ev.name, input: ev.input || {}, status: 'running', output: '' };
        if (state.lastAssistant) state.lastAssistant.tools.push(ev.id);
        if (ev.seq) state.bySeq[ev.seq] = state.toolsById[ev.id];
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'tool_result': {
        if (ev.seq && state.bySeq[ev.seq]) { _bumpSeq(state, ev.seq); break; }
        const t = state.toolsById[ev.id];
        if (t) {
          t.status = ev.is_error ? 'error' : 'done';
          t.output = ev.output || '';
        }
        if (ev.seq) state.bySeq[ev.seq] = t || { seq: ev.seq };
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'session':
        _bumpSeq(state, ev.seq);
        break;
      case 'error': {
        const m = { kind: 'error', text: ev.message, status: 'error', seq: ev.seq };
        state.messages.push(m);
        if (ev.seq) state.bySeq[ev.seq] = m;
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'queued':
        state.queue = (ev.items || []).slice();
        break;
      default:
        break;
    }
    return state;
  }

  // Retire la bulle assistant en vol NON finalisée (pas de seq). À appeler avant une
  // reconnexion : le serveur la renverra (tour en cours -> message_start+catch-up) ou enverra
  // sa version durable (assistant_message) au replay -> évite la double bulle (#12).
  function dropInFlight(state) {
    const m = state.inFlight;
    if (m) {
      const i = state.messages.indexOf(m);
      if (i >= 0) state.messages.splice(i, 1);
      if (m.message_id) delete state.byId[m.message_id];
      state.inFlight = null;
    }
    return state;
  }

  const MekiChat = { createState, reduce, dropInFlight };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiChat;
  if (typeof window !== 'undefined') root.MekiChat = MekiChat;
})(typeof window !== 'undefined' ? window : globalThis);
