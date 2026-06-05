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
    let live = false;          // false tant qu'on rejoue l'historique (avant le marqueur 'attached')
    let replayBuf = '';        // accumulateur du scrollback rejoué (assaini d'un bloc à 'attached')

    function sendWs(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }

    // Assainit le scrollback REJOUÉ : retire UNIQUEMENT les séquences qui font RÉPONDRE le terminal
    // (sinon, rejouées, leurs réponses partent en INPUT du PTY et polluent la ligne de commande —
    // ex. `\x1b[c` -> xterm renvoie `\x1b[?1;2c`). On GARDE couleurs, déplacements de curseur et
    // effacements -> les redessins incrémentaux de PSReadLine se rendent correctement (l'historique
    // est fidèle). Le flux LIVE (après 'attached') reste 100% brut.
    function sanitizeForReplay(s) {
      return s
        .replace(/\x1b\[[<>=?]?[0-9;]*c/g, '')      // Device Attributes (DA) : ESC [ … c
        .replace(/\x1b\[[0-9;]*n/g, '')             // Device Status Report (DSR) : ESC [ … n (5n/6n)
        .replace(/\x1b\[\?[0-9;]*\$[p-y]/g, '')     // requête de mode (DECRQM) : ESC [ ? … $ p
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC (titre/requêtes couleur) : ESC ] … BEL|ST
        .replace(/\x1bP[^\x1b]*\x1b\\/g, '');        // DCS : ESC P … ST
    }

    // Recalcule cols/rows depuis la taille du host et notifie le PTY. `force` envoie même si
    // la taille n'a pas changé : indispensable à l'ouverture de la WS, car le tout 1er fit a lieu
    // AVANT la connexion (sendWs no-op) — sans force, le PTY resterait à 80x24 (spawn) alors
    // qu'xterm affiche une autre largeur -> PSReadLine recalcule mal les retours ligne (corruption).
    function doFit(force) {
      if (!fit || !term || destroyed) return;
      const r = container.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return; // pas encore dimensionné (DOM en cours de pose)
      try { fit.fit(); } catch (_) { /* host transitoirement à 0 */ }
      const cols = term.cols, rows = term.rows;
      if (cols && rows && (force || cols !== lastCols || rows !== lastRows)) {
        lastCols = cols; lastRows = rows;
        sendWs({ type: 'resize', cols: cols, rows: rows });
      }
    }

    function connect() {
      if (destroyed) return; // défense : un reconnect en vol ne ressuscite pas une vue détruite
      const myGen = ++generation;
      intentionalClose = false;
      live = false;           // (re)connexion -> on repart en mode replay jusqu'au 'attached'
      replayBuf = '';
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/ws/term/' + terminalId);
      ws.addEventListener('open', () => {
        backoff = 500;
        sendWs({ type: 'attach', since_seq: lastSeq });
        doFit(true); // FORCE la taille réelle au PTY dès l'attache (sinon il reste à 80x24)
      });
      ws.addEventListener('message', (e) => {
        if (myGen !== generation) return; // socket périmée (destroy/reconnect)
        let ev;
        try { ev = JSON.parse(e.data); } catch (_) { return; }
        if (ev.type === 'output') {
          lastSeq = ev.seq;
          if (!term) return;
          if (live) term.write(ev.data);          // live : flux brut (couleurs, curseur, etc.)
          else replayBuf += ev.data;              // replay : on accumule pour assainir d'un bloc
        } else if (ev.type === 'attached') {
          // fin du replay : écrit l'historique ASSAINI d'un seul coup (pas de coupure de séquence
          // au milieu d'un chunk), puis passe en live (brut).
          if (term && replayBuf) {
            term.write(sanitizeForReplay(replayBuf));
            if (!replayBuf.endsWith('\n')) term.write('\r\n');
          }
          replayBuf = '';
          live = true;
        } else if (ev.type === 'exit') {
          if (term) {
            const code = (ev.code !== null && ev.code !== undefined) ? ' — code ' + ev.code : '';
            term.write('\r\n\x1b[90m[processus terminé' + code + ' — recharge pour relancer]\x1b[0m\r\n');
          }
        }
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

      // --- copier/coller (l'API clipboard marche sur localhost = contexte sûr) ---
      function copySelection() {
        const sel = term.getSelection();
        if (sel && navigator.clipboard) { navigator.clipboard.writeText(sel).catch(() => {}); return true; }
        return false;
      }
      function pasteClipboard() {
        if (!navigator.clipboard) return;
        navigator.clipboard.readText().then((t) => { if (t) term.paste(t); }).catch(() => {});
      }
      // Ctrl/Cmd+C : copie la sélection si présente (sinon on laisse xterm envoyer \x03 = interrupt).
      // Ctrl/Cmd+V : on colle NOUS-MÊMES et on preventDefault -> ça SUPPRIME l'événement `paste`
      // natif du navigateur (que xterm écouterait aussi) : exactement UN collage, pas deux.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return true;
        const k = (e.key || '').toLowerCase();
        if (k === 'c' && (term.hasSelection() || e.shiftKey)) { if (copySelection()) return false; }
        if (k === 'v' && !e.shiftKey) { e.preventDefault(); pasteClipboard(); return false; }
        return true;
      });
      // Clic droit : colle (réflexe console Windows) — ou copie si une sélection est active.
      // (contextmenu preventDefault -> pas de menu navigateur ni de collage natif : pas de doublon.)
      container.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (term.hasSelection()) copySelection();
        else pasteClipboard();
      });
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
      get cols() { return term ? term.cols : 0; },
      get rows() { return term ? term.rows : 0; },
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
