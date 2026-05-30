// Vue DOM du node chat (Discord-fidèle, layout A). Impérative, comme les autres nodes.
// Cycle de vie WS calqué sur l'EditorView : mount() renvoie un handle { el, destroy }.
// destroy() ferme la WS proprement (intentionalClose) et coupe le backoff -> zéro fuite
// quand le node est re-rendu / retiré (renderNodes/rerenderNode appellent destroy()).
(function (root) {
  'use strict';

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      const html = window.marked.parse ? window.marked.parse(text || '') : window.marked(text || '');
      return window.DOMPurify.sanitize(html);
    }
    const d = document.createElement('div');
    d.textContent = text || ''; // fallback : texte échappé, JAMAIS de HTML brut non assaini
    return d.innerHTML;
  }

  function mount(container, conversationId, component) {
    const MekiChat = window.MekiChat;
    let convId = conversationId;
    let state = MekiChat.createState();
    let ws = null;
    let generation = 0;
    let intentionalClose = false;
    let backoff = 500;
    let reconnectTimer = null;
    let streamEl = null;   // élément de contenu de la bulle en vol (fast-path text_delta)
    let streamMid = null;

    // --- DOM ---
    const wrap = el('div', 'cmp-chat');
    const header = el('div', 'chat-header');
    const dot = el('span', 'chat-dot');
    const title = el('span', 'chat-title');
    title.textContent = (component && component.title) || 'chat';
    const spacer = el('span', 'chat-spacer');
    const newBtn = el('button', 'chat-new');
    newBtn.type = 'button';
    newBtn.textContent = '✨ Nouvelle session';
    header.append(dot, title, spacer, newBtn);

    const statusBar = el('div', 'chat-statusbar');
    const statusText = el('span', 'chat-status-text');
    statusText.textContent = '✦ Claude écrit…';
    const stopBtn = el('button', 'chat-stop');
    stopBtn.type = 'button';
    stopBtn.textContent = '⏹ Stop';
    statusBar.append(statusText, stopBtn);
    statusBar.style.display = 'none';

    const list = el('div', 'chat-messages');
    const chips = el('div', 'chat-chips');
    const composer = el('div', 'chat-composer');
    const ta = el('textarea', 'chat-input');
    ta.placeholder = (component && component.placeholder) || 'Écris à Claude…';
    const send = el('button', 'chat-send');
    send.type = 'button';
    send.textContent = '➤';
    composer.append(ta, send);
    wrap.append(header, statusBar, list, chips, composer);
    container.append(wrap);

    // ne pas laisser le node-wrap parent capter scroll/clic (zoom/move/select)
    [list, ta].forEach((e) => e.addEventListener('wheel', (ev) => ev.stopPropagation()));
    [composer, header, statusBar, chips].forEach((e) =>
      e.addEventListener('mousedown', (ev) => ev.stopPropagation())
    );

    // --- rendu ---
    function render() {
      list.innerHTML = '';
      streamEl = null;
      for (const m of state.messages) {
        const row = el('div', 'chat-row chat-' + m.kind);
        const avatar = el('div', 'chat-avatar chat-av-' + m.kind);
        avatar.textContent = m.kind === 'user' ? 'C' : m.kind === 'assistant' ? '✦' : '!';
        const body = el('div', 'chat-body');
        const name = el('div', 'chat-name');
        name.textContent = m.kind === 'user' ? 'charles' : m.kind === 'assistant' ? 'Claude' : 'erreur';
        const content = el('div', 'chat-content');
        if (m.kind === 'assistant' && m.status !== 'streaming') {
          content.innerHTML = renderMarkdown(m.text);
        } else {
          content.textContent = m.text || '';
        }
        if (m.status === 'streaming') {
          content.append(el('span', 'chat-cursor'));
          streamEl = content;
          streamMid = m.message_id;
        }
        body.append(name, content);
        if (m.status === 'interrupted') body.append(el('div', 'chat-interrupted'));
        row.append(avatar, body);
        list.append(row);
      }
      list.scrollTop = list.scrollHeight;

      // La statusbar « Claude écrit… » suit l'EXISTENCE d'une bulle en vol (pas un état deviné) :
      // après un reload d'une conversation finie, inFlight est null -> pas de barre figée (#7).
      statusBar.style.display = state.inFlight ? 'flex' : 'none';

      chips.innerHTML = '';
      state.queue.forEach((it) => {
        const chip = el('span', 'chat-chip');
        chip.textContent = '⏳ ' + it.text + ' ';
        const x = el('span', 'chat-chip-x');
        x.textContent = '✕';
        x.addEventListener('click', () => sendWs({ type: 'cancel_queued', index: it.index }));
        chip.append(x);
        chips.append(chip);
      });
    }

    function applyEvent(ev) {
      MekiChat.reduce(state, ev);
      // fast-path streaming : ne re-render PAS tout l'historique à chaque token (coût
      // quadratique sur longue réponse, #8) -> on met à jour seulement la bulle en vol.
      if (ev.type === 'text_delta' && streamEl && streamMid === ev.message_id && state.inFlight) {
        streamEl.textContent = state.inFlight.text;
        streamEl.appendChild(el('span', 'chat-cursor'));
        list.scrollTop = list.scrollHeight;
        return;
      }
      render();
    }

    // --- WebSocket ---
    function sendWs(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }

    function connect() {
      const myGen = ++generation;
      intentionalClose = false;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/ws/chat/' + convId);
      ws.addEventListener('open', () => {
        backoff = 500;
        // À la (re)connexion, jeter la bulle en vol non finalisée : le serveur la renverra (tour
        // en cours) ou enverra sa version durable au replay -> pas de double bulle (#12).
        MekiChat.dropInFlight(state);
        render();
        sendWs({ type: 'attach', since_seq: state.lastSeq });
      });
      ws.addEventListener('message', (e) => {
        if (myGen !== generation) return; // socket périmée (clear/destroy)
        const ev = JSON.parse(e.data);
        if (ev.type === 'cleared') { rotateTo(ev.conversation_id); return; }
        applyEvent(ev);
      });
      ws.addEventListener('close', () => {
        if (intentionalClose || myGen !== generation) return;
        reconnectTimer = setTimeout(connect, backoff + Math.random() * 250);
        backoff = Math.min(backoff * 2, 8000);
      });
    }

    function closeWs() {
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (ws) { try { ws.close(); } catch (_) { /* déjà fermée */ } }
    }

    function rotateTo(newId) {
      closeWs();
      convId = newId;
      if (component) component.conversation_id = newId; // garde l'objet composant en phase
      state = MekiChat.createState();
      render();
      connect();
    }

    // --- interactions ---
    function submit() {
      const text = ta.value.trim();
      if (!text) return;
      sendWs({ type: 'prompt', text: text });
      ta.value = '';
    }
    send.addEventListener('click', submit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    stopBtn.addEventListener('click', () => sendWs({ type: 'stop' }));
    newBtn.addEventListener('click', () => sendWs({ type: 'clear' }));

    render();
    connect();

    return {
      el: wrap,
      destroy() {
        generation++; // invalide les closures des sockets en vol
        closeWs();
      },
    };
  }

  const MekiChatView = { mount };
  if (typeof window !== 'undefined') root.MekiChatView = MekiChatView;
})(typeof window !== 'undefined' ? window : globalThis);
