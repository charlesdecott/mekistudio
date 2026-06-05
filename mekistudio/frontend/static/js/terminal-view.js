// Vue DOM du node terminal : xterm.js + WebSocket /ws/term. Impérative, comme les autres
// nodes. Cycle de vie WS calqué sur chat-view (generation guard, backoff, intentionalClose).
// mount() renvoie { el, destroy } ; destroy() ferme la WS + libère xterm + l'observer (zéro
// fuite au re-render). xterm/FitAddon sont des globals UMD (window.Terminal / window.FitAddon),
// vendorés et chargés avant canvas.js. La sortie PTY arrive en `str` (déjà décodé côté serveur).
(function (root) {
  'use strict';

  function mount(container, terminalId, component) {
    let ws = null;
    let term = null;
    let fit = null;
    let ro = null;
    let lastSeq = 0;            // dernier seq reçu -> attach{since_seq} à la reconnexion
    let generation = 0;        // invalide les closures des sockets périmées
    let intentionalClose = false;
    let backoff = 500;
    let reconnectTimer = null;
    let resizeTimer = null;
    let destroyed = false;
    let lastCols = 0;
    let lastRows = 0;

    function sendWs(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }

    // Recalcule cols/rows depuis la taille du host et notifie le PTY (si ça a changé).
    function doFit() {
      if (!fit || !term || destroyed) return;
      const r = container.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return; // pas encore dimensionné (DOM en cours de pose)
      try { fit.fit(); } catch (_) { /* host transitoirement à 0 */ }
      const cols = term.cols, rows = term.rows;
      if (cols && rows && (cols !== lastCols || rows !== lastRows)) {
        lastCols = cols; lastRows = rows;
        sendWs({ type: 'resize', cols: cols, rows: rows });
      }
    }

    function connect() {
      if (destroyed) return; // défense : un reconnect en vol ne ressuscite pas une vue détruite
      const myGen = ++generation;
      intentionalClose = false;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/ws/term/' + terminalId);
      ws.addEventListener('open', () => {
        backoff = 500;
        sendWs({ type: 'attach', since_seq: lastSeq });
        doFit(); // pousse la taille courante au PTY dès l'attache
      });
      ws.addEventListener('message', (e) => {
        if (myGen !== generation) return; // socket périmée (destroy/reconnect)
        let ev;
        try { ev = JSON.parse(e.data); } catch (_) { return; }
        if (ev.type === 'output') {
          lastSeq = ev.seq;
          if (term) term.write(ev.data);
        } else if (ev.type === 'exit') {
          if (term) {
            const code = (ev.code !== null && ev.code !== undefined) ? ' — code ' + ev.code : '';
            term.write('\r\n\x1b[90m[processus terminé' + code + ' — recharge pour relancer]\x1b[0m\r\n');
          }
        }
        // 'attached' : fin de replay -> rien de spécial côté terminal.
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

    // Démarrage DIFFÉRÉ : à l'appel de mount() le host n'est pas encore attaché/dimensionné
    // (renderComponent le retourne ensuite au node-wrap). On attend un frame pour que fit()
    // mesure une vraie taille.
    requestAnimationFrame(() => {
      if (destroyed) return;
      term = new root.Terminal({
        cursorBlink: true,
        convertEol: false, // le PTY envoie déjà des \r\n
        fontSize: 13,
        fontFamily: 'Consolas, "Cascadia Code", "Courier New", monospace',
        scrollback: 5000,
        theme: { background: '#0b0e14', foreground: '#c7d0e0', cursor: '#4d8dff' },
      });
      const FitCtor = root.FitAddon && root.FitAddon.FitAddon;
      if (FitCtor) { fit = new FitCtor(); term.loadAddon(fit); }
      term.open(container);
      doFit();
      // clavier -> PTY (xterm sérialise déjà les touches/séquences en str)
      term.onData((d) => sendWs({ type: 'input', data: d }));
      // re-fit au redimensionnement du node (débouncé)
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          if (resizeTimer) return;
          resizeTimer = setTimeout(() => { resizeTimer = null; doFit(); }, 80);
        });
        ro.observe(container);
      }
      connect();
    });

    return {
      el: container,
      destroy() {
        destroyed = true;
        generation++; // invalide les sockets en vol
        if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
        if (ro) { try { ro.disconnect(); } catch (_) {} ro = null; }
        closeWs();
        if (term) { try { term.dispose(); } catch (_) {} term = null; }
      },
    };
  }

  const MekiTerminal = { mount };
  if (typeof window !== 'undefined') root.MekiTerminal = MekiTerminal;
})(typeof window !== 'undefined' ? window : globalThis);
