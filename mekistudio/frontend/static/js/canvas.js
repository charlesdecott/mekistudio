// Composant Alpine du canvas. On l'enregistre via l'événement `alpine:init`
// (et ce script est chargé AVANT celui d'Alpine) : sinon course de démarrage —
// Alpine boote dès que le DOM est parsé (scripts `defer`, readyState
// "interactive") et évaluerait `x-data="canvas"` avant que ce fichier ne
// définisse le composant => "canvas is not a function".
document.addEventListener('alpine:init', () => {
  Alpine.data('canvas', () => ({
    projectName: window.__PROJECT_NAME__ || 'mekistudio',
    tool: 'select',          // 'select' | 'move' | 'resize'
    selectedId: null,
    // modale de réglages (node configurable)
    settingsOpen: false,
    settingsTitle: '',
    settingsExcludes: [],
    newExclude: '',
    settingsError: '',
    settingsNode: null,
    _settingsTree: null,
    _editors: {},            // états des nodes éditeur, indexés par node id
    _zTop: 0,                // dernier z-index attribué (premier plan au clic)
    _editorSpawns: 0,        // éditeurs en cours de spawn (réserve la position en cascade)
    panning: false,
    last: { x: 0, y: 0 },
    view: { x: 0, y: 0, zoom: 1 },
    _saveTimer: null,
    _dragBoxes: null,        // snapshot des boîtes pendant un drag (évite un reflow/frame)

    async init() {
      let state = {};
      try {
        const r = await fetch('/api/canvas');
        if (r.ok) state = await r.json();
      } catch (e) { /* canvas vide par défaut */ }
      const v = state.viewport;
      const defaultView = !v || (v.x === 0 && v.y === 0 && v.zoom === 1);
      if (v) this.view = v;
      const nodes = state.nodes || [];
      this.renderNodes(nodes);
      // Au tout premier affichage (vue par défaut), on centre sur le kernel.
      if (defaultView) this.centerOnKernel(nodes);
      this.drawCables(); // câbles initiaux (le layer SVG est créé ici, après les wraps)
    },

    // Rendu des nodes en DOM direct : Alpine gère le pan/zoom du canvas, le
    // contenu d'un node est un arbre de composants rendu récursivement. Les
    // node-wrap vivent dans .world, donc héritent du transform translate/scale.
    renderNodes(nodes) {
      const world = this.$root.querySelector('.world');
      if (!world) return;
      world.replaceChildren(...nodes.map((n) => this.renderNode(n)));
    },
    renderNode(node) {
      const wrap = document.createElement('div');
      wrap.className = 'node-wrap';
      wrap.dataset.id = node.id;
      wrap.dataset.kind = node.kind || '';
      wrap.dataset.movable = node.movable !== false;
      wrap.dataset.resizable = node.resizable !== false;
      wrap.dataset.configurable = node.configurable === true;
      wrap.dataset.source = node.source_id || ''; // graphe de câbles lu depuis le DOM
      this.applyBox(wrap, node);
      wrap.appendChild(this.renderComponent(node.root, node));
      if (node.configurable) wrap.appendChild(this.makeGear(node));
      wrap.addEventListener('mousedown', (e) => this.onNodeMouseDown(e, node, wrap));
      return wrap;
    },
    applyBox(wrap, node) {
      wrap.style.left = (node.x || 0) + 'px';
      wrap.style.top = (node.y || 0) + 'px';
      wrap.style.width = node.w != null ? node.w + 'px' : '';
      wrap.style.height = node.h != null ? node.h + 'px' : '';
      wrap.classList.toggle('sized', node.w != null || node.h != null);
    },

    // Layer SVG unique des câbles, premier enfant de .world. Idempotent.
    ensureCablesLayer() {
      const world = this.$root.querySelector('.world');
      if (!world) return null;
      let svg = world.querySelector('svg.cables');
      if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'cables');
      }
      if (world.firstChild !== svg) world.insertBefore(svg, world.firstChild);
      return svg;
    },

    // Lit les boîtes de tous les nodes depuis le DOM : Map id -> {box, kind, source}.
    nodeBoxes() {
      const map = new Map();
      this.$root.querySelectorAll('.node-wrap').forEach((w) => {
        map.set(w.dataset.id, {
          box: { x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0,
                 w: w.offsetWidth, h: w.offsetHeight },
          kind: w.dataset.kind || '',
          source: w.dataset.source || '',
        });
      });
      return map;
    },

    // Recalcule et trace tous les câbles depuis une Map de boîtes (DOM impératif).
    drawCablesFrom(nodes) {
      const svg = this.ensureCablesLayer();
      if (!svg) return;
      const C = window.MekiCables;
      // 1) câbles enfant -> parent présent
      const cables = [];
      nodes.forEach((info, id) => {
        if (info.source && nodes.has(info.source)) cables.push({ id, parent: info.source });
      });
      // 2) côté choisi à chaque extrémité
      const sides = cables.map((cab) => ({
        child: C.adaptiveSide(nodes.get(cab.id).box, nodes.get(cab.parent).box),
        parent: C.adaptiveSide(nodes.get(cab.parent).box, nodes.get(cab.id).box),
      }));
      // 3) regroupe par (node, côté) pour attribuer les lanes aux DEUX extrémités
      const groups = new Map();
      const push = (nodeId, side, neighbor, ref) => {
        const k = nodeId + '|' + side;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ neighbor, ref });
      };
      cables.forEach((cab, i) => {
        push(cab.id, sides[i].child, nodes.get(cab.parent).box, { i, end: 'child' });
        push(cab.parent, sides[i].parent, nodes.get(cab.id).box, { i, end: 'parent' });
      });
      const offChild = new Array(cables.length).fill(0);
      const offParent = new Array(cables.length).fill(0);
      groups.forEach((list, key) => {
        const cut = key.lastIndexOf('|');
        const box = nodes.get(key.slice(0, cut)).box;
        const offs = C.assignLanes(list, box, key.slice(cut + 1));
        list.forEach((item, j) => {
          if (item.ref.end === 'child') offChild[item.ref.i] = offs[j];
          else offParent[item.ref.i] = offs[j];
        });
      });
      // 4a) tracé de chaque câble : CONTOURNEMENT des autres nodes (obstacles gonflés
      // de PAD), masque si boîtes ~confondues (HIDE_DIST).
      const PAD = C.STUB;
      const obstaclesFor = (cab) => {
        const obs = [];
        nodes.forEach((info, oid) => {
          if (oid === cab.id || oid === cab.parent) return;
          const o = info.box;
          obs.push({ x: o.x - PAD, y: o.y - PAD, w: o.w + 2 * PAD, h: o.h + 2 * PAD });
        });
        return obs;
      };
      // état de routage par câble (face + offset) : permet de RE-ROUTER en préservant la face.
      const face = cables.map((cab, i) => ({ src: sides[i].child, tgt: sides[i].parent }));
      const off = cables.map((cab, i) => ({ src: offChild[i], tgt: offParent[i] }));
      const reroute = (i) => {
        const a = nodes.get(cables[i].id), b = nodes.get(cables[i].parent);
        const aA = C.sideAnchor(a.box, face[i].src, off[i].src);
        const aB = C.sideAnchor(b.box, face[i].tgt, off[i].tgt);
        return C.routeAround(aA, face[i].src, aB, face[i].tgt, obstaclesFor(cables[i]));
      };
      const routes = cables.map((cab, i) => {
        const a = nodes.get(cab.id), b = nodes.get(cab.parent);
        const dist = Math.hypot((a.box.x + a.box.w / 2) - (b.box.x + b.box.w / 2),
                                (a.box.y + a.box.h / 2) - (b.box.y + b.box.h / 2));
        return dist < C.HIDE_DIST ? null : reroute(i);
      });
      // 4b) ESCAPE : si un câble passe ENCORE sous un node, CHANGER la face de la node
      // concernée (pur 45°) plutôt que de le laisser traverser. On mémorise la face choisie.
      routes.forEach((r, i) => {
        if (!r) return;
        const obs = obstaclesFor(cables[i]);
        if (!C.pathHits(r, obs)) return;
        const a = nodes.get(cables[i].id), b = nodes.get(cables[i].parent);
        const av = C.routeAvoiding(a.box, face[i].src, b.box, face[i].tgt, obs);
        face[i] = { src: av.srcSide, tgt: av.tgtSide }; off[i] = { src: 0, tgt: 0 };
        routes[i] = av.pts;
      });
      // 4c) ANTI-SUPERPOSITION (ruban) : écarte les câbles PARALLÈLES trop proches en décalant
      // LE CÂBLE (offset, jamais le node), re-routé SUR SA FACE. Pré-filtre bbox, borné. Un
      // croisement (pentes ≠) est laissé tel quel.
      const cbox = (r) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of r) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      };
      const boxes = routes.map((r) => (r ? cbox(r) : null));
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (let i = 0; i < cables.length; i++) {
          for (let j = i + 1; j < cables.length; j++) {
            if (!routes[i] || !routes[j]) continue;
            if (!C.bboxesOverlap(boxes[i], boxes[j], C.RIBBON_GAP)) continue;
            if (!C.cablesOverlap(routes[i], routes[j], C.RIBBON_GAP)) continue;
            off[j].src += C.RIBBON_GAP; off[j].tgt += C.RIBBON_GAP; // décale le câble j
            routes[j] = reroute(j); boxes[j] = routes[j] ? cbox(routes[j]) : null;
            changed = true;
          }
        }
        if (!changed) break;
      }
      // 4d) trace (halo + net)
      const seen = new Set();
      cables.forEach((cab, i) => {
        let g = svg.querySelector('g[data-edge="' + cab.id + '"]');
        if (!routes[i]) { if (g) g.remove(); return; }
        seen.add(cab.id);
        const a = nodes.get(cab.id), b = nodes.get(cab.parent);
        const d = C.pointsToPath(routes[i]);
        if (!g) {
          g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.dataset.edge = cab.id;
          for (const cls of ['cable-halo', 'cable-core']) {
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('class', cls);
            g.appendChild(p);
          }
          svg.appendChild(g);
        }
        g.setAttribute('class', 'cable ' + C.cableClass(a.kind, b.kind));
        g.querySelector('.cable-halo').setAttribute('d', d);
        g.querySelector('.cable-core').setAttribute('d', d);
      });
      // 5) supprime les <g> orphelins
      svg.querySelectorAll('g[data-edge]').forEach((g) => {
        if (!seen.has(g.dataset.edge)) g.remove();
      });
    },

    drawCables() { this.drawCablesFrom(this.nodeBoxes()); },

    // Interaction d'un node selon l'outil actif. Un node ne déclenche jamais le
    // pan du canvas (stopPropagation systématique vers #canvas).
    onNodeMouseDown(e, node, wrap) {
      if (e.button !== 0) return;
      if (this.tool === 'select') {
        e.stopPropagation();
        this.selectNode(wrap);
        return;
      }
      const moving = this.tool === 'move' && node.movable !== false;
      const resizing = this.tool === 'resize' && node.resizable !== false;
      e.stopPropagation();
      if (!moving && !resizing) return; // node verrouillé pour cet outil
      e.preventDefault();
      this.selectNode(wrap);

      const z = this.view.zoom || 1;
      const sx = e.clientX, sy = e.clientY;
      const orig = {
        x: node.x || 0,
        y: node.y || 0,
        // taille auto -> taille rendue. offsetWidth ignore le transform scale()
        // de .world : c'est déjà en coords monde (donc pas de division par z).
        w: node.w != null ? node.w : wrap.offsetWidth,
        h: node.h != null ? node.h : wrap.offsetHeight,
      };
      this._dragBoxes = this.nodeBoxes(); // boîtes des AUTRES nodes figées le temps du drag
      let moved = false;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', finish);
        if (moved) this.persistNode(node); // pas de POST sur un simple clic
        this._dragBoxes = null;
        this.drawCables(); // re-route final avec lecture fraîche du DOM
      };
      const onMove = (ev) => {
        if (!(ev.buttons & 1)) return finish(); // bouton relâché hors fenêtre
        moved = true;
        const dx = (ev.clientX - sx) / z; // px écran -> px monde
        const dy = (ev.clientY - sy) / z;
        if (moving) { node.x = orig.x + dx; node.y = orig.y + dy; }
        if (resizing) {
          node.w = this.clampW(node, orig.w + dx);
          node.h = this.clampH(node, orig.h + dy);
        }
        this.applyBox(wrap, node);
        // re-route : seule la boîte du node manipulé change ; les autres viennent du cache.
        if (this._dragBoxes) {
          const m = new Map(this._dragBoxes);
          const prev = m.get(node.id) || { kind: wrap.dataset.kind, source: wrap.dataset.source };
          m.set(node.id, {
            box: { x: node.x || 0, y: node.y || 0,
                   w: node.w != null ? node.w : orig.w, h: node.h != null ? node.h : orig.h },
            kind: prev.kind, source: prev.source,
          });
          this.drawCablesFrom(m);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', finish);
    },
    clampW(node, w) { w = Math.max(140, w); return node.max_w ? Math.min(w, node.max_w) : w; },
    clampH(node, h) { h = Math.max(80, h); return node.max_h ? Math.min(h, node.max_h) : h; },
    selectNode(wrap) {
      this.$root.querySelectorAll('.node-wrap.selected').forEach((n) => n.classList.remove('selected'));
      wrap.classList.add('selected');
      this.selectedId = wrap.dataset.id;
      // passe au premier plan (utile quand des nodes se chevauchent, ex. éditeurs
      // en cascade : sinon le bouton fermer d'un node masqué est inaccessible).
      // z-index scopé au stacking context de .world (transform) -> jamais au-dessus
      // de la toolbar/HUD/modale.
      wrap.style.zIndex = ++this._zTop;
    },
    async persistNode(node) {
      try {
        await fetch('/api/canvas/nodes/' + node.id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: node.x, y: node.y, w: node.w, h: node.h }),
        });
      } catch (e) { /* best-effort */ }
    },
    centerOnKernel(nodes) {
      const k = (nodes || []).find((n) => n.kind === 'kernel');
      if (!k) return;
      const wrap = this.$root.querySelector('.node-wrap[data-kind="kernel"]');
      const w = k.w != null ? k.w : (wrap ? wrap.offsetWidth : 200);
      const h = k.h != null ? k.h : (wrap ? wrap.offsetHeight : 80);
      const cx = (k.x || 0) + w / 2;
      const cy = (k.y || 0) + h / 2;
      this.view.x = window.innerWidth / 2 - cx * this.view.zoom;
      this.view.y = window.innerHeight / 2 - cy * this.view.zoom;
    },

    // --- engrenage + modale de réglages (nodes configurables) ---
    makeGear(node) {
      const gear = document.createElement('button');
      gear.type = 'button';
      gear.className = 'node-gear';
      gear.title = 'Réglages';
      gear.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"'
        + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="12" cy="12" r="3"></circle>'
        + '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06'
        + 'a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4'
        + 'a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82'
        + ' 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82'
        + 'l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3'
        + 'a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83'
        + 'l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09'
        + 'a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
      gear.addEventListener('mousedown', (e) => e.stopPropagation());
      gear.addEventListener('click', (e) => { e.stopPropagation(); this.openSettings(node); });
      return gear;
    },
    findFileTree(c) {
      if (!c) return null;
      if (c.type === 'filetree') return c;
      for (const ch of c.children || []) {
        const found = this.findFileTree(ch);
        if (found) return found;
      }
      return null;
    },
    openSettings(node) {
      const ft = this.findFileTree(node.root);
      this.settingsNode = node;
      this._settingsTree = ft;
      this.settingsTitle = 'Réglages — ' + (node.kind || 'node');
      this.settingsExcludes = ft ? [...(ft.excludes || [])] : [];
      this.newExclude = '';
      this.settingsError = '';
      this.settingsOpen = true;
    },
    addExclude() {
      const v = (this.newExclude || '').trim();
      if (!v) return;
      if (v.includes('/') || v.includes('\\')) {
        this.settingsError = 'Un nom simple, pas un chemin (sans / ni \\).';
        return;
      }
      if (!this.settingsExcludes.includes(v)) this.settingsExcludes.push(v);
      this.newExclude = '';
      this.settingsError = '';
    },
    removeExclude(i) { this.settingsExcludes.splice(i, 1); },
    closeSettings() { this.settingsOpen = false; this.settingsError = ''; },
    async saveSettings() {
      const node = this.settingsNode;
      if (!node) return;
      this.settingsError = '';
      try {
        const r = await fetch('/api/canvas/nodes/' + node.id + '/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ excludes: this.settingsExcludes }),
        });
        if (!r.ok) { this.settingsError = "Échec de l'enregistrement (HTTP " + r.status + ')'; return; }
      } catch (e) {
        this.settingsError = 'Échec réseau lors de l\'enregistrement';
        return;
      }
      if (this._settingsTree) this._settingsTree.excludes = [...this.settingsExcludes];
      this.settingsOpen = false;
      // Re-rend UNIQUEMENT le node configuré (filetree avec les nouvelles
      // exclusions), pas tout le canvas : n'altère pas le node éditeur.
      this.rerenderNode(node);
    },
    // Re-rend un seul node en place : évite de re-monter l'EditorView (fuite)
    // et d'écraser une édition non sauvegardée lors d'un changement de réglages.
    // Le wrap garde sa classe .selected (donc l'engrenage reste visible).
    rerenderNode(node) {
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + node.id + '"]');
      if (!wrap) return;
      wrap.replaceChildren(this.renderComponent(node.root, node));
      if (node.configurable) wrap.appendChild(this.makeGear(node));
    },

    // --- nodes éditeur (CodeMirror via window.MekiEditor) ---
    // Plusieurs éditeurs possibles -> chaque state est autonome (closures) et
    // indexé par node id dans this._editors. Pas de slot global.
    mountEditor(host, comp, node) {
      const bar = document.createElement('div');
      bar.className = 'editor-bar';
      const name = document.createElement('span');
      name.className = 'editor-name';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'editor-save';
      save.textContent = 'Enregistrer';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'editor-close';
      close.title = 'Fermer';
      close.textContent = '✕';
      [save, close].forEach((b) => b.addEventListener('mousedown', (e) => e.stopPropagation()));
      bar.append(name, save, close);
      const cmHost = document.createElement('div');
      cmHost.className = 'editor-cm';
      host.append(bar, cmHost);

      const state = {
        nodeId: node ? node.id : null, comp, path: comp.file_path || '',
        handle: null, nameEl: name, saveBtn: save, dirty: false, pending: null,
      };
      save.disabled = !state.path;   // rien à sauver tant qu'aucun fichier ouvert
      save.addEventListener('click', (e) => { e.stopPropagation(); this.saveEditor(state); });
      close.addEventListener('click', (e) => { e.stopPropagation(); this.closeEditor(state); });
      if (state.nodeId) this._editors[state.nodeId] = state;

      const boot = () => this._bootEditor(cmHost, state);
      if (window.MekiEditor) { boot(); return; }
      window.addEventListener('meki-editor-ready', boot, { once: true });
      // Fallback : si CodeMirror (esm.sh) ne charge pas (hors-ligne, CDN down),
      // afficher un message plutôt qu'un éditeur muet.
      setTimeout(() => {
        if (!state.handle) {
          cmHost.classList.add('editor-unavailable');
          cmHost.textContent = "Éditeur indisponible — CodeMirror n'a pas pu charger (hors-ligne ?).";
        }
      }, 8000);
    },
    async _bootEditor(cmHost, state) {
      state.nameEl.textContent = state.path || '(aucun fichier)';
      let content = '';
      if (state.path) {
        try {
          const r = await fetch('/api/file?path=' + encodeURIComponent(state.path));
          if (r.ok) content = (await r.json()).content || '';
        } catch (e) { /* éditeur vide */ }
      }
      state.handle = window.MekiEditor.mount(cmHost, {
        path: state.path,
        doc: content,
        onSave: () => this.saveEditor(state),
        onChange: () => this.setDirty(state, true),
      });
      // Fichier ouvert pendant le chargement du CM ? on applique le contenu
      // mémorisé (sinon doc affiché et fichier persisté pourraient diverger).
      if (state.pending) {
        state.path = state.pending.path;
        state.handle.setDoc(state.pending.content, state.pending.path);
        state.pending = null;
      }
      state.saveBtn.disabled = !state.path;
      this.setDirty(state, false);
    },
    setDirty(state, d) {
      if (!state) return;
      // pas de fichier ouvert -> rien à sauver (pas d'indicateur trompeur)
      if (!state.path) { state.dirty = false; state.saveBtn.textContent = 'Enregistrer'; return; }
      state.dirty = d;
      state.saveBtn.textContent = d ? 'Enregistrer •' : 'Enregistrer';
    },
    async saveEditor(state) {
      if (!state || !state.handle || !state.path) return;
      try {
        const r = await fetch('/api/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: state.path, content: state.handle.getContent() }),
        });
        if (r.ok) this.setDirty(state, false);
      } catch (e) { /* best-effort */ }
    },
    async closeEditor(state) {
      if (!state) return;
      // warning si modifications non enregistrées
      if (state.dirty && !window.confirm(
        '« ' + (state.path || 'fichier') + " » a des modifications non enregistrées.\n"
        + 'Fermer sans sauvegarder ?')) return;
      // ne retirer du DOM que si le node est bien supprimé côté serveur (sinon
      // il réapparaîtrait au reload). 404 = déjà absent -> on peut retirer.
      if (state.nodeId) {
        let ok = false;
        try {
          const r = await fetch('/api/canvas/nodes/' + state.nodeId, { method: 'DELETE' });
          ok = r.ok || r.status === 404;
        } catch (e) { ok = false; }
        if (!ok) { window.alert('Échec de la fermeture (serveur injoignable) — réessaie.'); return; }
        delete this._editors[state.nodeId];
      }
      if (state.handle) state.handle.destroy();   // libère l'EditorView
      const wrap = state.nodeId
        && this.$root.querySelector('.node-wrap[data-id="' + state.nodeId + '"]');
      if (wrap) wrap.remove();
      this.drawCables(); // le câble disparaît avec le node source retiré
    },
    // Double-clic sur un fichier -> spawn un NOUVEAU node éditeur près de
    // l'explorateur (en cascade), ouvre le fichier dedans, le rend.
    async openFileInNewEditor(path) {
      // réserve une position de cascade SYNCHRONEMENT (avant les await) : deux
      // double-clics rapprochés donnent des positions distinctes.
      const slot = this.$root.querySelectorAll('.node-wrap[data-kind="fileeditor"]').length
        + this._editorSpawns;
      this._editorSpawns++;
      try {
        const pos = this.editorPosAt(slot);
        let node;
        try {
          const r = await fetch('/api/canvas/nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'fileeditor', x: pos.x, y: pos.y }),
          });
          if (!r.ok) return;
          node = await r.json();
        } catch (e) { return; }
        // ouvre le fichier ; si ça échoue, on ANNULE la création (pas d'éditeur
        // fantôme vide persisté).
        let opened = false;
        try {
          const r2 = await fetch('/api/canvas/nodes/' + node.id + '/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
          });
          if (r2.ok) { node = await r2.json(); opened = true; }
        } catch (e) { /* échec -> annulation ci-dessous */ }
        if (!opened) {
          try { await fetch('/api/canvas/nodes/' + node.id, { method: 'DELETE' }); } catch (e) {}
          return;
        }
        const world = this.$root.querySelector('.world');
        if (world) world.appendChild(this.renderNode(node));
        this.drawCables(); // câble du nouvel éditeur -> explorateur
      } finally {
        this._editorSpawns--;
      }
    },
    editorPosAt(slot) {
      // à droite de l'explorateur, décalé en cascade selon le slot réservé.
      const ex = this.$root.querySelector('.node-wrap[data-kind="fileexplorer"]');
      let bx = 360, by = 0, bw = 300;
      if (ex) {
        bx = parseFloat(ex.style.left) || 0;
        by = parseFloat(ex.style.top) || 0;
        bw = ex.offsetWidth || 300;
      }
      return { x: bx + bw + 40 + slot * 28, y: by + slot * 28 };
    },
    renderComponent(c, node) {
      if (!c || !c.type) return document.createComment('vide');
      if (c.type === 'header') {
        const lvl = Math.min(4, Math.max(1, c.level || 1));
        const el = document.createElement('h' + lvl);
        el.className = 'cmp-header level-' + lvl;
        el.textContent = c.text || '';
        return el;
      }
      if (c.type === 'layout') {
        const el = document.createElement('div');
        el.className = 'cmp-layout dir-' + (c.direction || 'column');
        el.style.gap = (c.gap ?? 8) + 'px';
        (c.children || []).forEach((ch) => el.appendChild(this.renderComponent(ch, node)));
        return el;
      }
      if (c.type === 'node') {
        const el = document.createElement('div');
        el.className = 'cmp-node';
        (c.children || []).forEach((ch) => el.appendChild(this.renderComponent(ch, node)));
        return el;
      }
      if (c.type === 'filetree') {
        const el = document.createElement('div');
        el.className = 'cmp-filetree';
        // La molette défile l'arbre au lieu de zoomer le canvas. (Le mousedown,
        // lui, est géré par le node-wrap parent : move/resize/select + anti-pan.)
        el.addEventListener('wheel', (ev) => ev.stopPropagation());
        // Container synchrone ; le contenu est chargé en async (fire-and-forget,
        // fsExpand affiche lui-même une ligne d'erreur si le fetch échoue).
        this.fsExpand(el, c.root_path || '', 0, c.excludes || []);
        return el;
      }
      if (c.type === 'editor') {
        const el = document.createElement('div');
        el.className = 'cmp-editor';
        // molette -> scroll de l'éditeur (pas zoom canvas).
        el.addEventListener('wheel', (ev) => ev.stopPropagation());
        this.mountEditor(el, c, node);
        return el;
      }
      // type inconnu : fallback visuel plutôt qu'un trou silencieux
      const el = document.createElement('div');
      el.className = 'cmp-unknown';
      el.textContent = c.type;
      return el;
    },

    // --- explorateur de fichiers (chargement paresseux via /api/fs) ---
    async fsExpand(listEl, path, depth, excludes) {
      excludes = excludes || [];
      const params = new URLSearchParams();
      params.set('path', path);
      excludes.forEach((x) => params.append('exclude', x));
      let data;
      try {
        const r = await fetch('/api/fs?' + params.toString());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        data = await r.json();
      } catch (e) {
        // Échec visible (et non un trou muet) : ligne d'erreur, retour false
        // pour que l'appelant n'estampille pas le dossier comme "chargé".
        listEl.replaceChildren(this.fsErrorRow(depth));
        return false;
      }
      listEl.replaceChildren(...(data.entries || []).map((e) => this.fsItem(e, depth, excludes)));
      return true;
    },
    fsErrorRow(depth) {
      const row = document.createElement('div');
      row.className = 'fs-row fs-error';
      row.style.paddingLeft = (6 + depth * 14) + 'px';
      row.textContent = '⚠️ échec du chargement';
      return row;
    },
    fsItem(entry, depth, excludes) {
      const item = document.createElement('div');
      item.className = 'fs-item';

      const row = document.createElement('div');
      row.className = 'fs-row';
      row.style.paddingLeft = (6 + depth * 14) + 'px';

      const caret = document.createElement('span');
      caret.className = 'fs-caret';
      caret.textContent = entry.kind === 'dir' ? '▸' : '';

      const icon = document.createElement('span');
      icon.className = 'fs-icon';
      icon.textContent = this.fsIcon(entry);

      const name = document.createElement('span');
      name.className = 'fs-name';
      name.textContent = entry.name;

      row.append(caret, icon, name);
      item.appendChild(row);

      if (entry.kind === 'dir') {
        const children = document.createElement('div');
        children.className = 'fs-list';
        children.hidden = true;
        item.appendChild(children);
        let loaded = false;
        row.addEventListener('click', async (ev) => {
          if (this.tool !== 'select') return; // déplier seulement avec Sélection
          ev.stopPropagation();
          const opening = children.hidden;
          children.hidden = !opening;
          caret.textContent = opening ? '▾' : '▸';
          // loaded posé seulement si le fetch réussit -> un dossier en échec
          // reste réessayable (re-clic) au lieu de rester vide à jamais.
          if (opening && !loaded) {
            loaded = await this.fsExpand(children, entry.path, depth + 1, excludes);
          }
        });
      } else {
        // simple clic = sélection seule ; double-clic = ouvrir dans l'éditeur (VSCode-like)
        row.addEventListener('click', (ev) => {
          if (this.tool !== 'select') return;
          ev.stopPropagation();
          this.$root.querySelectorAll('.fs-row.selected')
            .forEach((n) => n.classList.remove('selected'));
          row.classList.add('selected');
        });
        row.addEventListener('dblclick', (ev) => {
          if (this.tool !== 'select') return;
          ev.stopPropagation();
          this.openFileInNewEditor(entry.path);
        });
      }
      return item;
    },
    fsIcon(entry) {
      if (entry.kind === 'dir') return '📁';
      const ext = (entry.name.split('.').pop() || '').toLowerCase();
      const map = {
        py: '🐍', js: '📜', mjs: '📜', ts: '📜', json: '📋', md: '📝',
        css: '🎨', html: '🌐', txt: '📄', toml: '⚙️', cfg: '⚙️', ini: '⚙️',
        yml: '⚙️', yaml: '⚙️', lock: '🔒', sh: '⌨️', ps1: '⌨️',
        png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', ico: '🖼️',
      };
      return map[ext] || '📄';
    },

    // La grille (fond de #canvas) suit le viewport : feedback visuel du pan/zoom
    // même sans node affiché.
    gridStyle() {
      const s = 40 * this.view.zoom;
      return `background-size: ${s}px ${s}px; ` +
             `background-position: ${this.view.x}px ${this.view.y}px;`;
    },
    worldStyle() {
      return `transform: translate(${this.view.x}px, ${this.view.y}px) ` +
             `scale(${this.view.zoom});`;
    },

    startPan(e) { this.panning = true; this.last = { x: e.clientX, y: e.clientY }; },
    onPan(e) {
      if (!this.panning) return;
      this.view.x += e.clientX - this.last.x;
      this.view.y += e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
    },
    endPan() { if (this.panning) { this.panning = false; this.scheduleSave(); } },

    onZoom(e) {
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(4, Math.max(0.2, this.view.zoom * factor));
      // Ancrage au curseur : le point du monde sous la souris reste fixe à
      // l'écran (#canvas remplit la fenêtre, donc clientX/Y == coords canvas).
      const wx = (e.clientX - this.view.x) / this.view.zoom;
      const wy = (e.clientY - this.view.y) / this.view.zoom;
      this.view.x = e.clientX - wx * newZoom;
      this.view.y = e.clientY - wy * newZoom;
      this.view.zoom = newZoom;
      this.scheduleSave();
    },

    scheduleSave() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.save(), 400);
    },
    async save() {
      try {
        await fetch('/api/canvas/viewport', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: this.view.x, y: this.view.y, zoom: this.view.zoom }),
        });
      } catch (e) { /* best-effort */ }
    },
  }));
});
