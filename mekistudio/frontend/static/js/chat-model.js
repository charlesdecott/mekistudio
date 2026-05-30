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
      orphanTools: [],      // tool_use rejoués AVANT la bulle de leur groupe (replay) -> rattachés à la prochaine
    };
  }

  function _bumpSeq(state, seq) {
    if (typeof seq === 'number' && seq > state.lastSeq) state.lastSeq = seq;
  }

  // Vide les tool_use orphelins (bufferisés au replay) dans la bulle `m` qu'on vient d'ouvrir.
  // L'ordre durable est `tool_use(s) du groupe ... puis assistant_message du groupe`, donc les
  // orphelins en attente appartiennent TOUJOURS à la prochaine bulle créée -> attribution correcte.
  function _flushOrphans(state, m) {
    if (!state.orphanTools.length) return;
    for (const id of state.orphanTools) if (!m.tools.includes(id)) m.tools.push(id);
    state.orphanTools = [];
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
        _flushOrphans(state, m);  // reattach mi-tour : des tool_use durables rejoués avant ce message_start
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
        _flushOrphans(state, m);  // les tool_use du groupe (persistés AVANT cet assistant_message) -> cette bulle
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'tool_use': {
        if (ev.seq && state.bySeq[ev.seq]) { _bumpSeq(state, ev.seq); break; }
        state.toolsById[ev.id] = { id: ev.id, name: ev.name, input: ev.input || {}, status: 'running', output: '' };
        // LIVE : la bulle du groupe est déjà ouverte (inFlight) -> rattachement direct.
        // REPLAY/reattach : pas de bulle en vol (le tool_use durable PRÉCÈDE l'assistant_message de
        // son groupe) -> bufferiser, _flushOrphans le rattachera à la prochaine bulle.
        if (state.inFlight) state.inFlight.tools.push(ev.id);
        else state.orphanTools.push(ev.id);
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
      // Bulle MI-OUTIL (porte déjà des cartes) : NE PAS la supprimer. Au reattach, le tool_use
      // (seq déjà vu) est exclu du replay (read_since strict >) ; on perdrait la carte. On garde la
      // bulle + son lien byId, on réinitialise juste le texte ; le serveur re-émet message_start
      // {même id} (tour 'running') -> reset en place via le case 'message_start', tools conservés.
      if ((m.tools || []).length > 0) {
        m.text = '';
        m.status = 'streaming';
        state.inFlight = null;
        return state;
      }
      const i = state.messages.indexOf(m);
      if (i >= 0) state.messages.splice(i, 1);
      if (m.message_id) delete state.byId[m.message_id];
      if (state.lastAssistant === m) state.lastAssistant = null;  // ne pas pointer une bulle supprimée
      state.inFlight = null;
    }
    return state;
  }

  const MekiChat = { createState, reduce, dropInFlight };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiChat;
  if (typeof window !== 'undefined') root.MekiChat = MekiChat;
})(typeof window !== 'undefined' ? window : globalThis);
