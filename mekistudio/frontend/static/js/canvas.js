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
    settingsKind: '',        // F3b : 'chat' -> formulaire d'auto-spawn ; sinon exclusions (fileExplorer)
    settingsMode: 'ephemeral',
    settingsTtl: 10,
    settingsCap: 20,
    settingsCompact: false,  // brique G : toggle de compaction des dossiers (explorateur)
    _settingsTree: null,
    _compactMode: false,     // brique G : chaîne de dossiers compacte (lu des réglages explorateur)
    _creatingFolders: {},    // path -> true pendant la création d'un node dossier (anti-doublon)
    _materializingDepth: 0,  // >0 tant qu'un auto-spawn matérialise -> les dossiers naissent invisibles (comète). Compteur (spawns concurrents).
    _editors: {},            // états des nodes éditeur, indexés par node id
    _chatViews: {},          // handles des vues chat (WS), indexés par node id
    _zTop: 0,                // dernier z-index attribué (premier plan au clic)
    panning: false,
    last: { x: 0, y: 0 },
    view: { x: 0, y: 0, zoom: 1 },
    _saveTimer: null,
    _dragDir: { x: 0, y: 0 }, // vecteur cumulatif saisie->curseur (sens du drag pour la collision)
    _pendingSpots: [],       // spots d'éditeurs réservés (spawns concurrents)
    _toolbar: null,          // mini-toolbar ⚡ du node sélectionné
    _activePulses: 0,        // nb de comètes en vol (concurrentes) ; garde-fou anti-emballement
    _glowTimers: {},         // id -> timeout d'extinction du glow
    _dismissOff: {},         // id -> handler click d'acquittement (glow persistant) ; 1 seul par node
    // Brique F3a : auto-spawn d'éditeurs éphémères (aperçus des fichiers lus par Claude).
    _ephemeralTimers: {},    // id -> timeout de disparition (TTL)
    _pinHandlers: {},        // id -> handler click d'épingle (clic = garder)
    _spawning: {},           // file_path -> true pendant un spawn (anti double-spawn en rafale)
    _inFlightSpawns: 0,      // spawns en cours (pas encore dans le DOM) -> comptés par le plafond
    _spawnMode: 'ephemeral', // F3b : 'ephemeral' (TTL) | 'capped' (plafond FIFO) | 'unlimited'
    _spawnTtlMs: 600000,     // 10 min (lu des réglages du chat ; F3b)
    _spawnCap: 20,           // max d'auto-spawnés vivants (lu des réglages du chat ; F3b)

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
      this._readSpawnSettings(nodes); // F3b : applique les réglages d'auto-spawn du chat
      this._readCompactMode(nodes);   // brique G : lit le toggle de compaction de l'explorateur
      this.reconcileOverlaps();   // sépare les nodes hérités qui se chevauchent (zéro recouvrement)
      // Au tout premier affichage (vue par défaut), on centre sur le kernel.
      if (defaultView) this.centerOnKernel(nodes);
      this.drawCables(); // câbles initiaux (le layer SVG est créé ici, après les wraps)
      // Brique G : au boot on NE re-calcule PAS les positions (on respecte la disposition persistée :
      // chaque node a été placé une fois et n'a plus bougé). On cadre juste la 1re ouverture.
      if (defaultView) this.fitView();
      this.refreshGit(); // brique G : charge l'état git de la node « branch git »
      // Brique F : reçoit les intentions d'impulsion dispatched depuis chat-view.js
      document.addEventListener('meki:impulse', (e) => this.applyIntent(e.detail));
      // Brique G : la node git se rafraîchit à la fin de tour du chat (événementiel).
      document.addEventListener('meki:turn-end', () => this.refreshGit());
    },
    // Passe ordonnée déterministe : figés d'abord (murs), puis mobiles triés par id ;
    // chaque node placé devient obstacle pour les suivants. Persiste les déplacés.
    reconcileOverlaps() {
      const C = window.MekiCollision;
      const wraps = [...this.$root.querySelectorAll('.node-wrap')];
      const fixed = wraps.filter((w) => w.dataset.movable === 'false');
      const movable = wraps.filter((w) => w.dataset.movable !== 'false')
        .sort((a, b) => (a.dataset.id < b.dataset.id ? -1 : 1));
      const placed = fixed.map((w) => this._homeBox(w));
      for (const w of movable) {
        const home = this._homeBox(w);
        if (C.isFree(home, placed, C.GAP)) { placed.push(home); continue; }
        const spot = C.findFreeSpot(home, { w: home.w, h: home.h }, placed, C.GAP);
        w.style.left = spot.x + 'px'; w.style.top = spot.y + 'px';
        placed.push({ x: spot.x, y: spot.y, w: home.w, h: home.h });
        this._persistPos(w.dataset.id, spot.x, spot.y);
      }
    },

    // Rendu des nodes en DOM direct : Alpine gère le pan/zoom du canvas, le
    // contenu d'un node est un arbre de composants rendu récursivement. Les
    // node-wrap vivent dans .world, donc héritent du transform translate/scale.
    renderNodes(nodes) {
      const world = this.$root.querySelector('.world');
      if (!world) return;
      // détruire les vues chat existantes AVANT de remplacer le DOM (sinon WS + timer
      // de backoff fuient vers un DOM détaché — cas du boot/reload).
      Object.values(this._chatViews).forEach((v) => v && v.destroy());
      this._chatViews = {};
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
      // file_path n'est PAS à root.file_path : il est imbriqué dans l'arbre (composant type 'editor').
      if (node.kind === 'fileeditor') wrap.dataset.file = this.fileOfComponent(node.root);
      // Brique G : un node dossier porte son chemin (lookup DOM par dossier + masquage dérivé).
      if (node.kind === 'folder') wrap.dataset.folder = node.path || '';
      if (node.ephemeral) this._markEphemeral(wrap, node); // aperçu auto-spawné (F3a) : style + TTL + clic=épingle
      this.applyBox(wrap, node);
      wrap.appendChild(this.renderComponent(node.root, node));
      // Brique G : capacité réduire/agrandir (git + dossier) — barre de titre seule quand réduit.
      if (this._isCollapsible(node)) {
        wrap.classList.toggle('collapsed', !!node.collapsed);
        wrap.appendChild(this.makeCollapseToggle(node));
      }
      if (node.configurable) wrap.appendChild(this.makeGear(node));
      if (node.kind === 'folder') wrap.appendChild(this.makeFolderClose(node)); // dossier supprimable
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
    // Déplacement TRANSITOIRE (coords monde) d'un node poussé, sans toucher son home.
    setTranslate(wrap, dx, dy) {
      wrap._tx = dx; wrap._ty = dy;
      wrap.style.transform = (dx || dy) ? `translate(${dx}px, ${dy}px)` : '';
    },
    clearTranslate(wrap) { this.setTranslate(wrap, 0, 0); },
    // Box RENDUE en coords monde = home (style.left/top) + translate transitoire.
    boxOf(wrap) {
      return {
        x: (parseFloat(wrap.style.left) || 0) + (wrap._tx || 0),
        y: (parseFloat(wrap.style.top) || 0) + (wrap._ty || 0),
        w: wrap.offsetWidth, h: wrap.offsetHeight,
      };
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
          box: this.boxOf(w),  // position RENDUE (home + translate) -> câbles suivent les nodes poussés
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

    // Outil suppression : ferme un node FERMABLE en un clic. Fichier -> closeEditor (garde « non
    // sauvegardé »). Dossier -> closeFolderNode (shift = ferme aussi le contenu). Built-in
    // (kernel/git/explorateur/chat) non fermables -> petit flash rouge (feedback).
    async _deleteNode(node, wrap, shift) {
      if (node.kind === 'folder') { this.closeFolderNode(node, wrap, shift); return; }
      if (node.kind === 'fileeditor') {
        const st = this._editors[node.id];
        if (st) { this.closeEditor(st); return; }
        let ok = false; // pas d'état éditeur (rare) -> suppression directe
        try { const r = await fetch('/api/canvas/nodes/' + node.id, { method: 'DELETE' }); ok = r.ok || r.status === 404; } catch (e) { ok = false; }
        if (!ok) { this.glow(node.id, 'error', 800); return; }
        this._forgetEphemeral(node.id); this.clearGlow(node.id);
        if (this.selectedId === node.id) { this.hideToolbar(); this.selectedId = null; }
        wrap.remove(); this.drawCables(); this.reconcileFolderNodes();
        return;
      }
      this.glow(node.id, 'error', 600); // built-in non supprimable
    },

    // Interaction d'un node selon l'outil actif. Un node ne déclenche jamais le
    // pan du canvas (stopPropagation systématique vers #canvas).
    onNodeMouseDown(e, node, wrap) {
      if (e.button !== 0) return;
      if (this.tool === 'select') {
        e.stopPropagation();
        this.selectNode(wrap);
        return;
      }
      if (this.tool === 'delete') {                 // outil suppression : clic = ferme un node fermable
        e.stopPropagation();
        this._deleteNode(node, wrap, e.shiftKey);
        return;
      }
      const moving = this.tool === 'move' && node.movable !== false;
      const resizing = this.tool === 'resize' && node.resizable !== false;
      e.stopPropagation();
      if (!moving && !resizing) return; // node verrouillé pour cet outil
      e.preventDefault();
      this.selectNode(wrap);
      this.clearTranslate(wrap);          // on drague depuis le home, jamais d'une position écartée
      wrap.classList.add('dragging');
      this._dragDir = { x: 0, y: 0 };

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
      let moved = false;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', finish);
        wrap.classList.remove('dragging');
        const C = window.MekiCollision;
        const relogged = [];
        if (moving && moved) {
          // PASSE FINALE (seule autorité de l'invariant) : tout voisin dont le home recoupe
          // la box finale de A est RELOGÉ définitivement (findFreeSpot) ; les autres reviennent.
          const finalA = { x: node.x, y: node.y, w: wrap.offsetWidth, h: wrap.offsetHeight };
          const wraps = [...this.$root.querySelectorAll('.node-wrap')].filter((w) => w !== wrap);
          const obstacles = [finalA];
          for (const w of wraps) {
            const home = this._homeBox(w);
            if (w.dataset.movable === 'false') { this.clearTranslate(w); obstacles.push(home); continue; }
            if (C.intersects(finalA, home, C.GAP)) {
              const others = obstacles.concat(wraps.filter((o) => o !== w).map((o) => this._homeBox(o)));
              const pushed = this.boxOf(w);   // là où il a DÉJÀ été poussé pendant le drag
              const spot = C.isFree(pushed, others, C.GAP)
                ? { x: pushed.x, y: pushed.y }                               // reste où il a été poussé
                : C.findFreeSpot(home, { w: home.w, h: home.h }, others, C.GAP); // sinon, 1er trou libre
              this.clearTranslate(w);
              w.style.left = spot.x + 'px'; w.style.top = spot.y + 'px';
              obstacles.push({ x: spot.x, y: spot.y, w: home.w, h: home.h });
              relogged.push(w.dataset.id);
            } else { this.clearTranslate(w); obstacles.push(home); }
          }
        } else if (resizing && moved) {
          // pousse-et-reste : fige les voisins poussés en home définitif (D3), persiste.
          this.$root.querySelectorAll('.node-wrap').forEach((w) => {
            if (w === wrap || !(w._tx || w._ty)) return;
            const nx = (parseFloat(w.style.left) || 0) + w._tx, ny = (parseFloat(w.style.top) || 0) + w._ty;
            this.clearTranslate(w); w.style.left = nx + 'px'; w.style.top = ny + 'px';
            this._persistPos(w.dataset.id, nx, ny);
          });
        } else {
          this.$root.querySelectorAll('.node-wrap').forEach((w) => { if (w !== wrap) this.clearTranslate(w); });
        }
        for (const id of relogged) {
          const w = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
          if (w) this._persistPos(id, parseFloat(w.style.left) || 0, parseFloat(w.style.top) || 0);
        }
        if (moved) this.persistNode(node); // A persisté en DERNIER (cohérence si échec réseau partiel)
        this.drawCables();
      };
      const onMove = (ev) => {
        if (!(ev.buttons & 1)) return finish(); // bouton relâché hors fenêtre
        moved = true;
        const dx = (ev.clientX - sx) / z; // px écran -> px monde
        const dy = (ev.clientY - sy) / z;
        if (moving) { node.x = orig.x + dx; node.y = orig.y + dy; this._dragDir = { x: dx, y: dy }; }
        if (resizing) {
          node.w = this.clampW(node, orig.w + dx);
          node.h = this.clampH(node, orig.h + dy);
        }
        this.applyBox(wrap, node);
        if (moving) this._pushNeighbors(wrap, node, orig); // écarte les voisins (peut clamper A)
        if (resizing) this._pushOnResize(wrap, node);      // pousse bas/droite (peut borner la taille)
        this.drawCables();                                  // re-route live (positions rendues)
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', finish);
    },
    _homeBox(w) {
      return { x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0,
               w: w.offsetWidth, h: w.offsetHeight };
    },
    // Écarte (translate transitoire) les voisins que A percute ; revient avec hystérésis ;
    // kernel = mur (clamp A) ; les 2 côtés bloqués -> clamp A (no-cascade).
    _pushNeighbors(wrap, node, orig) {
      const C = window.MekiCollision;
      const moverBox = { x: node.x, y: node.y, w: orig.w, h: orig.h };
      const decided = [];
      const wraps = [...this.$root.querySelectorAll('.node-wrap')].filter((w) => w !== wrap);
      const clampA = (home) => {
        const cl = C.clampAgainst({ x: orig.x, y: orig.y },
          { x: node.x, y: node.y, w: orig.w, h: orig.h }, home, C.GAP);
        node.x = cl.x; node.y = cl.y; this.applyBox(wrap, node);
        moverBox.x = node.x; moverBox.y = node.y;
      };
      for (const w of wraps) {
        const home = this._homeBox(w);
        if (!C.intersects(moverBox, home, C.GAP)) {
          if ((w._tx || w._ty) && !C.intersects(moverBox, home, C.GAP + C.EPS)) this.clearTranslate(w);
          decided.push(this.boxOf(w));
          continue;
        }
        if (w.dataset.movable === 'false') { clampA(home); decided.push(home); continue; }
        const obstacles = [moverBox, ...decided];
        wraps.forEach((o) => {
          if (o === w || o._tx || o._ty) return;
          obstacles.push(this._homeBox(o));
        });
        const cands = C.partVector(moverBox, home, this._dragDir, C.GAP);
        let placed = null;
        for (const v of cands) {
          const target = { x: home.x + v.x, y: home.y + v.y, w: home.w, h: home.h };
          if (C.isFree(target, obstacles, C.GAP)) { placed = v; break; }
        }
        if (placed) {
          this.setTranslate(w, placed.x, placed.y);
          decided.push({ x: home.x + placed.x, y: home.y + placed.y, w: home.w, h: home.h });
        } else { clampA(home); decided.push(home); }
      }
    },
    // Au resize (ancre haut-gauche), pousse les voisins recouverts vers le bas/droite ;
    // ils RESTENT écartés (figés au lâcher). Borne la taille si un 3e node bloque.
    _pushOnResize(wrap, node) {
      const C = window.MekiCollision;
      const grown = { x: node.x, y: node.y, w: node.w, h: node.h };
      const wraps = [...this.$root.querySelectorAll('.node-wrap')].filter((w) => w !== wrap);
      for (const w of wraps) {
        if (w.dataset.movable === 'false') continue;
        const home = this._homeBox(w);
        if (!C.intersects(grown, home, C.GAP)) continue;
        const v = C.pushVector(grown, home, C.GAP);
        const others = [];
        wraps.forEach((o) => { if (o !== w) others.push(this.boxOf(o)); });
        const target = { x: home.x + v.x, y: home.y + v.y, w: home.w, h: home.h };
        if (C.isFree(target, others, C.GAP)) this.setTranslate(w, v.x, v.y);
        else { node.w = this.clampW(node, home.x - C.GAP - node.x); this.applyBox(wrap, node); }
      }
    },
    async _persistPos(id, x, y) {
      try {
        await fetch('/api/canvas/nodes/' + id, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x, y }),
        });
      } catch (e) { /* best-effort ; le boot réconcilie */ }
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
      if (this.tool === 'select') this.showToolbar(wrap); // ⚡ debug en mode sélection
    },
    // Mini-toolbar (⚡) sous le node sélectionné — élément frère dans .world.
    showToolbar(wrap) {
      this.hideToolbar();
      const world = this.$root.querySelector('.world');
      if (!world) return;
      const bar = document.createElement('div');
      bar.className = 'node-toolbar';
      bar.style.left = (parseFloat(wrap.style.left) || 0) + 'px';
      bar.style.top = ((parseFloat(wrap.style.top) || 0) + wrap.offsetHeight + 8) + 'px';
      const id = wrap.dataset.id;
      const zap = document.createElement('button');
      zap.type = 'button'; zap.className = 'node-toolbar-btn'; zap.textContent = '⚡';
      zap.title = 'Envoyer une impulsion (debug)';
      zap.addEventListener('mousedown', (e) => e.stopPropagation());
      zap.addEventListener('click', (e) => { e.stopPropagation(); this.firePulse(id); });
      bar.appendChild(zap);
      world.appendChild(bar);
      this._toolbar = bar;
    },
    hideToolbar() { if (this._toolbar) { this._toolbar.remove(); this._toolbar = null; } },
    // Nodes atteignables depuis startId (adjacence NON orientée via source_id).
    reachableFrom(byId, startId) {
      const adj = {};
      Object.values(byId).forEach((n) => {
        if (n.source && byId[n.source]) {
          (adj[n.id] = adj[n.id] || []).push(n.source);
          (adj[n.source] = adj[n.source] || []).push(n.id);
        }
      });
      const seen = new Set([startId]), q = [startId];
      while (q.length) {
        const c = q.shift();
        (adj[c] || []).forEach((nb) => { if (!seen.has(nb)) { seen.add(nb); q.push(nb); } });
      }
      return seen;
    },
    // Impulsion debug : depuis fromId vers une cible ATTEIGNABLE aléatoire (délègue à pulseTo).
    async firePulse(fromId) {
      const boxes = this.nodeBoxes();
      const byId = {};
      boxes.forEach((info, id) => { byId[id] = { id, source: info.source || null }; });
      const targets = [...this.reachableFrom(byId, fromId)].filter((id) => id !== fromId);
      if (!targets.length) return;
      const toId = targets[Math.floor(Math.random() * targets.length)];
      await this.pulseTo(fromId, toId, 'strong');
    },

    // Comète orientée fromId -> toId le long des câbles (pathBetween), nodes traversés en glow doux,
    // cible au niveau `arrivalLevel`. CONCURRENTE : plusieurs comètes peuvent voler en même temps
    // (chacune ses propres éléments SVG) ; garde-fou _activePulses pour éviter l'emballement sur une
    // rafale d'outils parallèles. Les segments d'UNE comète restent séquentiels (elle suit son chemin).
    // `drawChildId` (option, F3a) : le segment dont le childId vaut drawChildId voit son câble TRACÉ
    // progressivement par la comète (au lieu d'être déjà visible) -> « la comète construit le câble ».
    async pulseTo(fromId, toId, arrivalLevel, drawChildId) {
      if (!fromId || !toId || fromId === toId) return;
      if (this._activePulses >= 24) return; // anti-emballement (ex. 100 lectures parallèles)
      const boxes = this.nodeBoxes();
      const byId = {};
      boxes.forEach((info, id) => { byId[id] = { id, source: info.source || null }; });
      const path = window.MekiCables.pathBetween(byId, fromId, toId);
      if (!path || !path.length) return;
      this._activePulses += 1;
      try {
        for (const seg of path) {
          // Brique G : la comète CONSTRUIT le câble de tout node neuf ('spawning') qu'elle traverse
          // (dossiers ET éditeur) et le RÉVÈLE en arrivant -> les dossiers naissent le long de l'impulsion.
          const childWrap = this.$root.querySelector('.node-wrap[data-id="' + seg.childId + '"]');
          const building = (childWrap && childWrap.classList.contains('spawning')) || seg.childId === drawChildId;
          await this.animateComet(seg, building);
          const arrived = seg.dir === 'up' ? seg.parentId : seg.childId;
          const aw = this.$root.querySelector('.node-wrap[data-id="' + arrived + '"]');
          if (aw && aw.classList.contains('spawning')) { aw.classList.remove('spawning'); this.glow(arrived, 'strong', 1100); }
          else if (arrived !== toId) this.glow(arrived, 'soft', 600);
        }
        this.glow(toId, arrivalLevel || 'strong', 1500);
      } finally {
        this._activePulses -= 1;
      }
    },

    kindId(kind) {
      const w = this.$root.querySelector('.node-wrap[data-kind="' + kind + '"]');
      return w ? w.dataset.id : null;
    },

    // Cherche récursivement le file_path du composant 'editor' dans l'arbre de composants du node.
    fileOfComponent(comp) {
      if (!comp) return '';
      if (comp.type === 'editor' && comp.file_path) return comp.file_path;
      if (comp.children) for (const c of comp.children) { const f = this.fileOfComponent(c); if (f) return f; }
      return '';
    },

    // F3b : trouve le ChatComponent dans un arbre, et lit ses réglages d'auto-spawn vers l'état front.
    _findChat(comp) {
      if (!comp) return null;
      if (comp.type === 'chat') return comp;
      for (const c of (comp.children || [])) { const f = this._findChat(c); if (f) return f; }
      return null;
    },
    _readSpawnSettings(nodes) {
      const chatNode = (nodes || []).find((n) => n.kind === 'chat');
      const chat = chatNode && this._findChat(chatNode.root);
      if (!chat) return;
      this._spawnMode = chat.spawn_mode || 'ephemeral';
      this._spawnTtlMs = (chat.spawn_ttl_min || 10) * 60000;
      this._spawnCap = chat.spawn_cap || 20;
    },

    editorIdForFile(filePath) {
      if (!filePath) return null;
      // match robuste (relatif/absolu/./), via le matcher PUR teste de chat-impulses.
      const m = window.MekiImpulses && window.MekiImpulses.fileMatch;
      const wraps = this.$root.querySelectorAll('.node-wrap[data-kind="fileeditor"]');
      for (const w of wraps) if (w.dataset.file && m && m(w.dataset.file, filePath)) return w.dataset.id;
      return null;
    },

    // Glow persistant + clic sur le node = extinction (acquittement). Capture pour passer AVANT les
    // stopPropagation internes du chat. UN SEUL handler par node (glow() vient de purger le précédent),
    // retiré par clearGlow -> pas d'accumulation de listeners sur les tours non acquittés.
    glowDismissable(id, level, ms) {
      this.glow(id, level, ms);
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      if (!wrap) return;
      const off = () => { this.clearGlow(id); };
      this._dismissOff[id] = off;
      wrap.addEventListener('click', off, true);
    },

    // Exécute une intention d'impulsion (issue de MekiImpulses.impulseFor).
    applyIntent(intent) {
      if (!intent) return;
      if (intent.kind === 'comet') {
        const chatId = this.kindId('chat');
        // cible par 'file' (éditeur du fichier, si ouvert) OU par 'kind' (ex. explorateur).
        const toId = intent.target.by === 'file'
          ? this.editorIdForFile(intent.target.value)
          : this.kindId(intent.target.value);
        if (!toId) {
          // F3a : fichier lu mais AUCUN éditeur ouvert -> on SPAWN un éditeur éphémère (la comète
          // matérialise le fichier). Sinon (cible par kind introuvable) -> repli éventuel.
          if (intent.target.by === 'file') { this.spawnEphemeralEditor(intent.target.value); return; }
          if (intent.fallback) this.applyIntent(intent.fallback);
          return;
        }
        if (chatId) this.pulseTo(chatId, toId, intent.level || 'strong'); // comète qui VOYAGE (comme le mode debug ⚡)
        return;
      }
      const id = intent.target.by === 'kind' ? this.kindId(intent.target.value) : intent.target.value;
      if (!id) return;
      // dismissable (Stop / Notification) -> PERSISTANT (ms=0) jusqu'au clic ; sinon auto-fade.
      if (intent.dismissable) { this.glowDismissable(id, intent.level, 0); return; }
      this.glow(id, intent.level, intent.level === 'soft' ? 600 : 1500);
    },

    // Chemin lu (hook Read = ABSOLU à backslashes sur Windows) -> RELATIF posix au repo.
    // Indispensable : sans ça la clé front (absolue) ne matche jamais le chemin normalisé du
    // serveur -> dossiers re-créés à chaque lecture (DOUBLONS) + éditeur arraché de sa node
    // dossier (purge "le dossier disparaît, il reste le fichier").
    _repoRel(p) {
      const I = window.MekiImpulses;
      return (I && I.toRepoRel) ? I.toRepoRel(p, window.__REPO_ROOT__ || '') : (p || '');
    },

    // --- F3a : auto-spawn d'un éditeur éphémère pour un fichier lu mais non ouvert ---
    async spawnEphemeralEditor(rawPath) {
      const path = this._repoRel(rawPath);                  // NORMALISE en TOUT PREMIER (clé canonique)
      if (!path || this._spawning[path]) return;            // rafale du même fichier -> 1 seul spawn
      // hors-repo (reste absolu après normalisation) : aucun node fichier -> comète vers l'explorateur
      if (window.MekiImpulses && window.MekiImpulses.isAbsPath(path)) {
        const cId = this.kindId('chat'), exId = this.kindId('fileexplorer');
        if (cId && exId) this.pulseTo(cId, exId, 'soft');
        return;
      }
      const existing = this.editorIdForFile(path);
      if (existing) {                                       // dedup : déjà ouvert -> comète + ré-arme TTL
        const chatId = this.kindId('chat');
        if (chatId) this.pulseTo(chatId, existing, 'strong');
        const w = this.$root.querySelector('.node-wrap[data-id="' + existing + '"]');
        if (this._spawnMode === 'ephemeral' && w && w.classList.contains('ephemeral')) this._rearmTtl(existing); // TTL ré-armé (mode éphémère)
        return;
      }
      this._spawning[path] = true;
      this._inFlightSpawns += 1;                            // compte le spawn EN VOL (pas encore dans le DOM) pour le plafond
      this._enforceSpawnCap();
      const created = [];     // dossiers créés par CET appel (suivi précis, pas un diff DOM global -> pas de collision entre spawns concurrents)
      let pos = null, nodeId = null;
      this._materializingDepth += 1; // les dossiers naissent invisibles (comète) tant qu'au moins un spawn matérialise
      try {
        // Brique G : matérialise la chaîne de dossiers du fichier, puis ancre l'éditeur sur SA node dossier.
        const folderWrap = await this._ensureFolderChain(path, created);
        const folderId = folderWrap ? folderWrap.dataset.id : undefined;
        pos = this.editorSpawnPos(folderWrap);
        let node;
        try {
          const r = await fetch('/api/canvas/nodes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            // F3b : 'ephemeral' = aperçu + TTL ; 'capped' = aperçu sans TTL (plafond FIFO) ; 'unlimited' = permanent.
            // collapsed:true -> l'éditeur auto-spawné d'un READ naît RÉDUIT (barre de titre = nom du fichier).
            body: JSON.stringify({ kind: 'fileeditor', x: pos.x, y: pos.y, source_id: folderId, collapsed: true, ephemeral: this._spawnMode !== 'unlimited', expires_at_ms: this._spawnMode === 'ephemeral' ? Date.now() + this._spawnTtlMs : null }),
          });
          if (!r.ok) return;
          node = await r.json();
        } catch (e) { return; }
        let opened = false;
        try {
          const r2 = await fetch('/api/canvas/nodes/' + node.id + '/open', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
          });
          if (r2.ok) { node = await r2.json(); opened = true; }
        } catch (e) { /* échec -> annulation */ }
        if (!opened) {
          try { await fetch('/api/canvas/nodes/' + node.id, { method: 'DELETE' }); } catch (e) {} // rollback : pas de node fantôme
          const cId = this.kindId('chat'), exId = this.kindId('fileexplorer'); // échec d'ouverture -> repli comète explorateur
          if (cId && exId) this.pulseTo(cId, exId, 'soft');
          return; // le finally révèle quand même les dossiers créés (jamais d'invisibles bloqués)
        }
        const world = this.$root.querySelector('.world');
        if (!world) return;
        const wrap = this.renderNode(node);               // pose la classe 'ephemeral' + TTL + clic=épingle
        wrap.classList.add('spawning');                    // invisible jusqu'à l'arrivée de la comète
        world.appendChild(wrap);
        nodeId = node.id;
        // les nouveaux nodes (dossiers + éditeur) sont DÉJÀ placés (editorSpawnPos, trou libre) ; on ne
        // bouge rien d'existant. On (re)dessine les câbles puis on cadre si ça déborde.
        this.drawCables();
        this.fitView();
        this._enforceSpawnCap();                            // node maintenant dans le DOM : re-vérifie le plafond (rafale)
        // cache les câbles de TOUS les nodes neufs (dossiers + éditeur) : la comète les TRACE en arrivant.
        const svg = this.ensureCablesLayer();
        const newIds = created.map((w) => w.dataset.id).concat([node.id]);
        for (const nid of newIds) {
          const g = svg && svg.querySelector('g[data-edge="' + nid + '"]');
          const core = g && g.querySelector('.cable-core');
          if (core) { const L = core.getTotalLength(); g.querySelectorAll('path').forEach((pa) => { pa.style.strokeDasharray = '0 ' + (L + 1); }); }
        }
        const chatId = this.kindId('chat');
        if (chatId) await this.pulseTo(chatId, node.id, 'strong'); // la comète matérialise dossiers + éditeur le long du chemin
        if (wrap.isConnected) this.glow(node.id, 'strong', 1500); // APPARAÎT
      } finally {
        this._materializingDepth = Math.max(0, this._materializingDepth - 1);
        // TOUJOURS révéler ce que CET appel a créé (dossiers + éditeur) + câbles complets — quelle que soit
        // la sortie (succès, échec create/open, retour anticipé) : jamais de node bloqué invisible.
        const svg = this.ensureCablesLayer();
        const revealIds = created.map((w) => w.dataset.id);
        if (nodeId) revealIds.push(nodeId);
        for (const nid of revealIds) {
          const g = svg && svg.querySelector('g[data-edge="' + nid + '"]');
          if (g) g.querySelectorAll('path').forEach((pa) => { pa.style.strokeDasharray = ''; pa.style.strokeDashoffset = ''; });
          const w = this.$root.querySelector('.node-wrap[data-id="' + nid + '"]');
          if (w) w.classList.remove('spawning');
        }
        this._inFlightSpawns -= 1;
        delete this._spawning[path];
        if (pos) this._pendingSpots = this._pendingSpots.filter((s) => !(s.x === pos.x && s.y === pos.y));
      }
    },

    // Marque un node éditeur comme éphémère : style, timer TTL, clic = épingle (garder).
    _markEphemeral(wrap, node) {
      wrap.classList.add('ephemeral');
      this._armTtl(node.id, node.expires_at_ms);
      // clic SUR le node = épingle. Phase BUBBLE (pas capture) : les boutons Enregistrer/Fermer de
      // l'éditeur font stopPropagation -> ils n'atteignent pas le wrap (pas d'épingle parasite).
      const pin = () => this._pinNode(node.id);
      this._pinHandlers[node.id] = pin;
      wrap.addEventListener('click', pin);
    },

    _armTtl(id, expiresAtMs) {
      this._clearTtl(id);
      if (!expiresAtMs) return;
      const ms = Math.max(0, expiresAtMs - Date.now());
      this._ephemeralTimers[id] = setTimeout(() => this._expireEphemeral(id), ms);
    },
    _clearTtl(id) {
      if (this._ephemeralTimers[id]) { clearTimeout(this._ephemeralTimers[id]); delete this._ephemeralTimers[id]; }
    },
    _rearmTtl(id) { this._armTtl(id, Date.now() + this._spawnTtlMs); }, // lecture répétée (TTL front, non re-persisté v1)

    // Oublie tout l'état éphémère d'un node (timer + handler d'épingle) -> pas de fuite à l'expiration,
    // au recyclage, à l'épingle ou à la fermeture manuelle.
    _forgetEphemeral(id) {
      this._clearTtl(id);
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      if (wrap && this._pinHandlers[id]) wrap.removeEventListener('click', this._pinHandlers[id]);
      delete this._pinHandlers[id];
    },

    async _expireEphemeral(id) {
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      this._forgetEphemeral(id);
      if (!wrap || !wrap.classList.contains('ephemeral')) return; // épinglé entre-temps -> ne pas supprimer
      try { await fetch('/api/canvas/nodes/' + id, { method: 'DELETE' }); } catch (e) {}
      const w = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      if (w) { w.remove(); this.drawCables(); this.reconcileFolderNodes(); } // brique G : purge dossier vide
    },

    // Plafond : si trop d'ÉDITEURS auto-spawnés VIVANTS (DOM) + EN VOL, ferme le(s) plus ancien(s).
    // Brique G : on ne compte QUE les éditeurs (`data-kind="fileeditor"`) — les nodes dossier sont
    // éphémères aussi mais leur cycle de vie est compté-référence (reconcileFolderNodes + purge serveur),
    // pas FIFO ; les inclure ici supprimerait un dossier hébergeant encore des éditeurs.
    _enforceSpawnCap() {
      const eph = [...this.$root.querySelectorAll('.node-wrap.ephemeral[data-kind="fileeditor"]')];
      const over = eph.length + this._inFlightSpawns - this._spawnCap; // inclut les spawns en vol (pas encore dans le DOM)
      for (let i = 0; i < over && i < eph.length; i++) this._expireEphemeral(eph[i].dataset.id);
    },

    // Épingle : l'aperçu devient permanent. On AWAIT le serveur d'abord ; on ne mute l'UI qu'au succès
    // (sinon, sur échec réseau, le node paraîtrait épinglé mais serait purgé au reload).
    async _pinNode(id) {
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      if (!wrap || !wrap.classList.contains('ephemeral')) return;
      let ok = false;
      try { ok = (await fetch('/api/canvas/nodes/' + id + '/pin', { method: 'POST' })).ok; } catch (e) { ok = false; }
      if (!ok) { this.glow(id, 'error', 1500); return; } // échec : on garde l'aperçu (TTL/handler intacts) + flash
      this._forgetEphemeral(id);
      wrap.classList.remove('ephemeral');
    },
    // Anime une comète le long du câble du segment (sens du flux). Promise résolue à l'arrivée.
    // Vitesse CONSTANTE (durée ∝ longueur, mouvement linéaire) : un câble long n'accélère pas.
    // `draw` (F3a) : le câble est TRACÉ au fur et à mesure derrière la comète (stroke-dasharray) au
    // lieu d'être déjà visible -> effet « la comète construit le câble, pixel par pixel ».
    animateComet(seg, draw) {
      return new Promise((resolve) => {
        const svg = this.ensureCablesLayer();
        const g = svg && svg.querySelector('g[data-edge="' + seg.childId + '"]');
        const path = g && g.querySelector('.cable-core');
        if (!path) return resolve();
        const len = path.getTotalLength();
        const drawPaths = draw ? [...g.querySelectorAll('path')] : []; // core + halo à révéler
        const revealTo = (a, b) => drawPaths.forEach((pa) => { pa.style.strokeDasharray = (b - a) + ' ' + (len + 1); pa.style.strokeDashoffset = String(-a); });
        const clearDash = () => drawPaths.forEach((pa) => { pa.style.strokeDasharray = ''; pa.style.strokeDashoffset = ''; });
        if (draw) revealTo(0, 0); // caché au départ (la comète va le révéler)
        const NS = 'http://www.w3.org/2000/svg';
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'comet'); dot.setAttribute('r', '9'); svg.appendChild(dot);
        // Traînée plus longue. Les billes suivent l'HISTORIQUE des positions de l'orbe
        // (et non un décalage rigide) : elles restent là où l'orbe est passée et s'estompent
        // en s'éloignant -> effet de decay « reste un peu lumineuse après son passage ».
        const TRAIL = 22, STRIDE = 2; // STRIDE = nb de frames entre deux billes
        const trail = [];
        for (let i = 0; i < TRAIL; i++) {
          const c = document.createElementNS(NS, 'circle');
          c.setAttribute('class', 'comet-trail');
          c.setAttribute('r', (7.5 * (1 - i / TRAIL) + 1).toFixed(1));
          c.setAttribute('opacity', (0.6 * Math.pow(1 - i / TRAIL, 1.4)).toFixed(3));
          svg.appendChild(c); trail.push(c);
        }
        const hist = []; // positions récentes de l'orbe (frame par frame), plus récente en tête
        const place = () => trail.forEach((c, i) => {
          const h = hist[Math.min(hist.length - 1, (i + 1) * STRIDE)];
          if (h) { c.setAttribute('cx', h.x); c.setAttribute('cy', h.y); }
        });
        // La traînée s'éteint en douceur (decay) APRÈS le passage, sans retarder le segment suivant.
        const fadeOut = () => {
          const els = [dot, ...trail];
          const ops = els.map((c) => parseFloat(c.getAttribute('opacity') || '1'));
          let fstart = null;
          const FADE = 320;
          const fstep = (ts) => {
            if (fstart === null) fstart = ts;
            const k = Math.min(1, (ts - fstart) / FADE);
            els.forEach((c, i) => c.setAttribute('opacity', (ops[i] * (1 - k)).toFixed(3)));
            if (k < 1) requestAnimationFrame(fstep); else els.forEach((c) => c.remove());
          };
          requestAnimationFrame(fstep);
        };
        const SPEED = 0.7; // px/ms : vitesse constante quelle que soit la longueur du câble
        const dur = Math.max(240, len / SPEED); // plancher pour les tout petits câbles
        let start = null;
        const step = (ts) => {
          if (start === null) start = ts;
          const t = Math.min(1, (ts - start) / dur); // LINÉAIRE -> vitesse constante
          const at = seg.dir === 'up' ? t * len : (1 - t) * len; // sens du flux
          const p = path.getPointAtLength(at);
          dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
          if (draw) revealTo(seg.dir === 'up' ? 0 : at, seg.dir === 'up' ? at : len); // câble visible DERRIÈRE la comète
          hist.unshift({ x: p.x, y: p.y });
          if (hist.length > TRAIL * STRIDE + 1) hist.pop();
          place();
          if (t < 1) requestAnimationFrame(step);
          else { if (draw) clearDash(); resolve(); fadeOut(); } // arrivée : câble complet + on enchaîne + rémanence
        };
        requestAnimationFrame(step);
      });
    },
    // Allume un node. ms>0 : retrait auto (fondu CSS) ; ms=0 : persistant (notif).
    glow(id, level, ms) {
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      if (!wrap) return;
      if (this._glowTimers[id]) { clearTimeout(this._glowTimers[id]); delete this._glowTimers[id]; }
      this._unbindDismiss(id, wrap); // un glow qui remplace un glow dismissable -> retire son listener
      wrap.classList.remove('glow-soft', 'glow-strong', 'glow-notif', 'glow-error');
      wrap.classList.add('glow-' + level);
      if (ms > 0) {
        this._glowTimers[id] = setTimeout(() => {
          wrap.classList.remove('glow-' + level); delete this._glowTimers[id];
        }, ms);
      }
    },
    clearGlow(id) {
      if (this._glowTimers[id]) { clearTimeout(this._glowTimers[id]); delete this._glowTimers[id]; }
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      if (wrap) { wrap.classList.remove('glow-soft', 'glow-strong', 'glow-notif', 'glow-error'); this._unbindDismiss(id, wrap); }
    },
    _unbindDismiss(id, wrap) {
      if (this._dismissOff[id]) { wrap.removeEventListener('click', this._dismissOff[id], true); delete this._dismissOff[id]; }
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
      this.settingsNode = node;
      this.settingsKind = node.kind || '';
      this.settingsError = '';
      this.settingsTitle = 'Réglages — ' + (node.kind || 'node');
      if (node.kind === 'chat') { // F3b : réglages d'auto-spawn
        const chat = this._findChat(node.root);
        this.settingsMode = (chat && chat.spawn_mode) || 'ephemeral';
        this.settingsTtl = (chat && chat.spawn_ttl_min) || 10;
        this.settingsCap = (chat && chat.spawn_cap) || 20;
      } else {
        const ft = this.findFileTree(node.root);
        this._settingsTree = ft;
        this.settingsExcludes = ft ? [...(ft.excludes || [])] : [];
        this.settingsCompact = !!(ft && ft.compact_chain); // brique G : toggle de compaction (explorateur)
        this.newExclude = '';
      }
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
      const isChat = this.settingsKind === 'chat';
      const isExplorer = this.settingsKind === 'fileexplorer';
      const body = isChat
        ? { spawn_mode: this.settingsMode, spawn_ttl_min: Number(this.settingsTtl), spawn_cap: Number(this.settingsCap) }
        : (isExplorer
            ? { excludes: this.settingsExcludes, compact_chain: this.settingsCompact } // brique G : compaction
            : { excludes: this.settingsExcludes });
      try {
        const r = await fetch('/api/canvas/nodes/' + node.id + '/settings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!r.ok) { this.settingsError = "Échec de l'enregistrement (HTTP " + r.status + ')'; return; }
      } catch (e) {
        this.settingsError = 'Échec réseau lors de l\'enregistrement';
        return;
      }
      if (isChat) { // F3b : applique en DIRECT au front + au composant en mémoire (pas de re-render du chat)
        this._spawnMode = this.settingsMode;
        this._spawnTtlMs = Number(this.settingsTtl) * 60000;
        this._spawnCap = Number(this.settingsCap);
        const chat = this._findChat(node.root);
        if (chat) { chat.spawn_mode = this.settingsMode; chat.spawn_ttl_min = Number(this.settingsTtl); chat.spawn_cap = Number(this.settingsCap); }
        this.settingsOpen = false;
        return;
      }
      if (this._settingsTree) {
        this._settingsTree.excludes = [...this.settingsExcludes];
        if (isExplorer) this._settingsTree.compact_chain = this.settingsCompact; // brique G
      }
      if (isExplorer) this._compactMode = this.settingsCompact;
      this.settingsOpen = false;
      // Re-rend UNIQUEMENT le node configuré (filetree avec les nouvelles exclusions).
      this.rerenderNode(node);
      if (isExplorer) { this._refreshFolderClaims(); this.reconcileFolderNodes(); } // applique la (dé)compaction
    },
    // Re-rend un seul node en place : évite de re-monter l'EditorView (fuite)
    // et d'écraser une édition non sauvegardée lors d'un changement de réglages.
    // Le wrap garde sa classe .selected (donc l'engrenage reste visible).
    rerenderNode(node) {
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + node.id + '"]');
      if (!wrap) return;
      if (this._chatViews[node.id]) { this._chatViews[node.id].destroy(); delete this._chatViews[node.id]; }
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
    _setEditorName(state) {
      // affiche juste le NOM du fichier (pas le chemin) -> node plus petite + nom plus grand ;
      // le chemin complet reste en infobulle (survol).
      state.nameEl.textContent = state.path ? state.path.split('/').pop() : '(aucun fichier)';
      state.nameEl.title = state.path || '';
    },
    async _bootEditor(cmHost, state) {
      this._setEditorName(state);
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
        this._setEditorName(state);
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
      this.clearGlow(state.nodeId);
      if (state.nodeId) this._forgetEphemeral(state.nodeId); // fermeture manuelle d'un éphémère : purge timer/handler
      if (wrap) wrap.remove();
      if (this.selectedId === state.nodeId) { this.hideToolbar(); this.selectedId = null; }
      this.drawCables(); // le câble disparaît avec le node source retiré
      this.reconcileFolderNodes(); // brique G : purge les dossiers devenus vides
    },
    // Double-clic sur un fichier -> spawn un NOUVEAU node éditeur près de
    // l'explorateur (en cascade), ouvre le fichier dedans, le rend.
    async openFileInNewEditor(path) {
      // Brique G : garantit la chaîne de dossiers du fichier, puis place l'éditeur près de
      // SA node dossier (regroupement par dossier) ; câble dégagé via editorSpawnPos(ancre).
      const folderWrap = await this._ensureFolderChain(path);
      const pos = this.editorSpawnPos(folderWrap);
      const folderId = folderWrap ? folderWrap.dataset.id : undefined;
      try {
        let node;
        try {
          const r = await fetch('/api/canvas/nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'fileeditor', x: pos.x, y: pos.y, source_id: folderId }),
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
        this.drawCables(); this.fitView(); // node déjà placé (editorSpawnPos) ; rien d'existant ne bouge
      } finally {
        this._pendingSpots = this._pendingSpots.filter((s) => !(s.x === pos.x && s.y === pos.y));
      }
    },
    // Emplacement d'un NOUVEAU node (éditeur OU dossier) près de son ANCRE (parent), en croissant
    // VERS L'EXTÉRIEUR (dendrite) dans le 1er TROU LIBRE, câble dégagé. Placé UNE SEULE FOIS puis
    // laissé en place : on ne re-calcule JAMAIS les positions des nodes existants (pas de clignotement).
    // Éventail déterministe (sans aléa) -> placement prévisible et stable.
    editorSpawnPos(anchorWrap = null, size = { w: 520, h: 440 }) {
      const C = window.MekiCollision, K = window.MekiCables;
      const explorer = this.$root.querySelector('.node-wrap[data-kind="fileexplorer"]');
      const ex = anchorWrap || explorer;                 // ancre = node dossier du fichier, sinon explorateur
      let ab = { x: 360, y: 0, w: 300, h: 200 };
      if (ex) ab = this.boxOf(ex);
      const aC = { x: ab.x + ab.w / 2, y: ab.y + ab.h / 2 }; // centre de l'ancre (le parent)
      let exC = aC;
      if (explorer) { const b = this.boxOf(explorer); exC = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
      const all = [], cableObs = [], occupied = [];
      this.$root.querySelectorAll('.node-wrap').forEach((w) => {
        const box = this.boxOf(w); all.push(box);
        if (w === ex) return;                            // l'ancre est exclue du test de câble
        cableObs.push(box);
        occupied.push(Math.atan2((box.y + box.h / 2) - aC.y, (box.x + box.w / 2) - aC.x));
      });
      this._pendingSpots.forEach((s) => { all.push(s); cableObs.push(s); occupied.push(Math.atan2((s.y + s.h / 2) - aC.y, (s.x + s.w / 2) - aC.x)); });
      // câbles EXISTANTS (tracés) : on évite aussi de poser le nouveau node DESSUS (pas de câble sous une node).
      const cablePaths = [];
      const svg = this.$root.querySelector('.world svg.cables');
      if (svg) svg.querySelectorAll('g[data-edge] .cable-core').forEach((c) => {
        const nums = (c.getAttribute('d') || '').match(/-?\d+(\.\d+)?/g) || [];
        const pts = []; for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: +nums[i], y: +nums[i + 1] });
        if (pts.length >= 2) cablePaths.push(pts);
      });
      // Direction de base = VERS L'EXTÉRIEUR (de l'explorateur à travers l'ancre) -> la dendrite pousse
      // dehors. Si l'ancre EST l'explorateur (1er niveau), on vise le milieu du plus grand secteur libre.
      let baseAng;
      const odx = aC.x - exC.x, ody = aC.y - exC.y;
      if (Math.hypot(odx, ody) > 5) {
        baseAng = Math.atan2(ody, odx);
      } else {
        baseAng = 0; let gap = -1;
        const occ = occupied.slice().sort((a, b) => a - b);
        for (let i = 0; i < occ.length; i++) {
          const a0 = occ[i], a1 = i + 1 < occ.length ? occ[i + 1] : occ[0] + Math.PI * 2;
          if (a1 - a0 > gap) { gap = a1 - a0; baseAng = a0 + (a1 - a0) / 2; }
        }
      }
      const minR = Math.max(ab.w, ab.h) / 2 + Math.max(size.w, size.h) / 2 + 70;
      const at = (x, y) => ({ x: Math.round(x), y: Math.round(y), w: size.w, h: size.h });
      const ctr = (s) => ({ x: s.x + size.w / 2, y: s.y + size.h / 2 });
      let fallback = null;
      for (let i = 0; i < 60; i++) {
        const off = ((i % 2) ? 1 : -1) * Math.ceil(i / 2) * 0.2; // éventail ± autour de la direction extérieure
        const ang = baseAng + off;
        const dist = minR + Math.floor(i / 18) * 150;          // élargit l'anneau si tout est pris
        const cand = at(aC.x + Math.cos(ang) * dist - size.w / 2, aC.y + Math.sin(ang) * dist - size.h / 2);
        if (!C.isFree(cand, all, C.GAP)) continue;             // pas de chevauchement
        if (!fallback) fallback = cand;
        if (K && K.pathHits([ctr(cand), aC], cableObs)) continue; // le câble du node ne traverse pas un autre node
        if (K && cablePaths.some((pts) => K.pathHits(pts, [cand]))) continue; // ni un câble existant ne passe sous le node
        this._pendingSpots.push(cand);
        return cand;
      }
      const spot = fallback || C.findFreeSpot({ x: aC.x + minR, y: aC.y - size.h / 2 }, size, all, C.GAP);
      this._pendingSpots.push({ x: spot.x, y: spot.y, w: size.w, h: size.h });
      return spot;
    },
    // ===== Brique G : node git, dossiers-en-nodes, réduire/agrandir =====

    // Charge l'état git du repo et l'applique à toutes les nodes « branch git » du canvas.
    async refreshGit() {
      const els = this.$root.querySelectorAll('.cmp-gitbranch');
      if (!els.length || !window.MekiGitNode) return;
      let info = null;
      try { const r = await fetch('/api/git/branch'); if (r.ok) info = await r.json(); } catch (e) { /* best-effort */ }
      els.forEach((el) => window.MekiGitNode.render(el, info));
    },
    _readCompactMode(nodes) {
      const ex = (nodes || []).find((n) => n.kind === 'fileexplorer');
      const tree = ex && this.findFileTree(ex.root);
      this._compactMode = !!(tree && tree.compact_chain);
    },

    // --- réduire / agrandir (générique : git + dossier) ---
    _isCollapsible(node) { return node.kind === 'folder' || node.kind === 'gitbranch' || node.kind === 'fileeditor'; },
    makeCollapseToggle(node) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'node-collapse';
      btn.title = node.collapsed ? 'Agrandir' : 'Réduire';
      btn.textContent = node.collapsed ? '▸' : '▾';
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleCollapse(node, btn.closest('.node-wrap'), btn); });
      return btn;
    },
    async toggleCollapse(node, wrap, btn) {
      const next = !node.collapsed;
      node.collapsed = next;
      if (wrap) wrap.classList.toggle('collapsed', next);
      if (btn) { btn.textContent = next ? '▸' : '▾'; btn.title = next ? 'Agrandir' : 'Réduire'; }
      // éditeur qu'on AGRANDIT : CodeMirror était caché (display:none) -> re-mesure une fois affiché.
      if (!next && node.kind === 'fileeditor') {
        const st = this._editors[node.id];
        if (st && st.handle && st.handle.refresh) requestAnimationFrame(() => st.handle.refresh());
      }
      this.drawCables(); // la hauteur change (barre de titre seule) -> les câbles suivent
      try {
        await fetch('/api/canvas/nodes/' + node.id, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collapsed: next }),
        });
      } catch (e) { /* best-effort */ }
    },

    // --- node dossier : helpers de chemin ---
    _hasFolderNode(path) {
      if (!path) return false;
      // comparaison en JS (pas de sélecteur d'attribut) : un nom de dossier peut contenir un
      // guillemet/antislash légaux qui casseraient un sélecteur CSS interpolé.
      for (const w of this.$root.querySelectorAll('.node-wrap[data-kind="folder"]')) {
        if ((w.dataset.folder || '') === path) return true;
      }
      return false;
    },
    _isSegPrefix(prefix, path) {
      if (prefix === '') return true;
      return path === prefix || path.startsWith(prefix + '/');
    },
    openEditorFilePaths() {
      return [...this.$root.querySelectorAll('.node-wrap[data-kind="fileeditor"]')]
        .map((w) => w.dataset.file).filter(Boolean);
    },
    // Node dossier hôte d'un fichier = celui dont data-folder == dossier du fichier (s'il existe).
    _findFolderForPath(filePath) {
      const dir = window.MekiFolders.dirOf(filePath);
      if (!dir) return null;
      for (const w of this.$root.querySelectorAll('.node-wrap[data-kind="folder"]')) {
        if ((w.dataset.folder || '') === dir) return w;
      }
      return null;
    },
    // Ancre de placement = node dossier ancêtre la plus proche (plus long préfixe), sinon explorateur.
    _nearestFolderAnchor(path) {
      let best = null, bestLen = -1;
      this.$root.querySelectorAll('.node-wrap[data-kind="folder"]').forEach((w) => {
        const f = w.dataset.folder || '';
        if (f === path) return; // pas soi-même
        if (this._isSegPrefix(f, path)) {
          const n = f === '' ? 0 : f.split('/').length;
          if (n > bestLen) { best = w; bestLen = n; }
        }
      });
      return best || this.$root.querySelector('.node-wrap[data-kind="fileexplorer"]');
    },

    // --- création / suppression de nodes dossier ---
    async _createFolderNode(path, { pinned = false, createdOut = null } = {}) {
      if (!path || this._hasFolderNode(path) || this._creatingFolders[path]) return null;
      this._creatingFolders[path] = true;
      const anchor = this._nearestFolderAnchor(path);
      const pos = this.editorSpawnPos(anchor, { w: 300, h: 320 });
      try {
        const r = await fetch('/api/canvas/nodes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          // auto = éphémère (purge si vide) ; sortie à la main = épinglé (permanent).
          // collapsed:true -> les dossiers naissent PETITS (barre = nom) ; l'explorateur racine reste grand.
          body: JSON.stringify({ kind: 'folder', x: pos.x, y: pos.y, path, collapsed: true, ephemeral: !pinned }),
        });
        if (!r.ok) return null;
        const node = await r.json();
        const world = this.$root.querySelector('.world');
        if (world) {
          const w = this.renderNode(node);
          // né INVISIBLE tant qu'un spawn matérialise : la comète le matérialisera (pas de flash avant).
          if (this._materializingDepth > 0) w.classList.add('spawning');
          world.appendChild(w);
          if (createdOut) createdOut.push(w);
        }
        return node;
      } catch (e) { return null; }
      finally {
        delete this._creatingFolders[path];
        this._pendingSpots = this._pendingSpots.filter((s) => !(s.x === pos.x && s.y === pos.y));
      }
    },
    async _removeFolderNode(wrap) {
      if (!wrap) return;
      // rebranche les enfants directs au grand-parent (non destructif ; le path-aware confirme au reload)
      const gp = wrap.dataset.source || '';
      this.$root.querySelectorAll('.node-wrap[data-source="' + wrap.dataset.id + '"]')
        .forEach((c) => { c.dataset.source = gp; });
      try { await fetch('/api/canvas/nodes/' + wrap.dataset.id, { method: 'DELETE' }); } catch (e) {}
      wrap.remove();
    },
    // Masquage dérivé : un dossier de l'arbre qui possède sa propre node est masqué (classe fs-claimed).
    _refreshFolderClaims() {
      this.$root.querySelectorAll('.fs-item[data-path]').forEach((it) => {
        it.classList.toggle('fs-claimed', this._hasFolderNode(it.dataset.path));
      });
    },
    // Ajuste le viewport pour que TOUS les nodes tiennent à l'écran (auto-zoom). Ne dérange la vue
    // que si quelque chose déborde (sinon on respecte le pan/zoom courant). `force` recadre toujours.
    fitView(force) {
      const wraps = [...this.$root.querySelectorAll('.node-wrap')];
      if (!wraps.length) return;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const w of wraps) { const b = this.boxOf(w); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
      const pad = 90, W = window.innerWidth, H = window.innerHeight;
      if (!force) { // déjà tout visible ? -> ne pas bouger
        const sx0 = (x0 - pad) * this.view.zoom + this.view.x, sy0 = (y0 - pad) * this.view.zoom + this.view.y;
        const sx1 = (x1 + pad) * this.view.zoom + this.view.x, sy1 = (y1 + pad) * this.view.zoom + this.view.y;
        if (sx0 >= 0 && sy0 >= 0 && sx1 <= W && sy1 <= H) return;
      }
      const bw = (x1 - x0) + 2 * pad, bh = (y1 - y0) + 2 * pad;
      const zoom = Math.max(0.2, Math.min(W / bw, H / bh, 1.1)); // borné comme le zoom molette
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      this.view.zoom = zoom;
      this.view.x = W / 2 - cx * zoom;
      this.view.y = H / 2 - cy * zoom;
      this.scheduleSave();
    },

    // Re-câble (DOM) les nodes dossier + éditeurs par plus-long-préfixe — MIROIR du reconcile
    // serveur. Indispensable APRÈS création/suppression d'un node dossier : insérer un ancêtre ou
    // un point de branchement doit re-router les enfants existants tout de suite (sinon câble périmé
    // jusqu'au reload — créations concurrentes hors ordre, split en mode compact). N'attend rien du
    // serveur (qui réconcilie aussi de son côté), ne touche pas un éditeur SANS fichier (override).
    _recableFolders() {
      const explorer = this.$root.querySelector('.node-wrap[data-kind="fileexplorer"]');
      const cands = [];
      if (explorer) cands.push({ path: '', id: explorer.dataset.id });
      this.$root.querySelectorAll('.node-wrap[data-kind="folder"]')
        .forEach((w) => cands.push({ path: w.dataset.folder || '', id: w.dataset.id }));
      const longest = (target, selfId, strict) => {
        let bestId = null, bestLen = -1;
        for (const c of cands) {
          if (c.id === selfId) continue;
          if (strict && c.path === target) continue;
          if (this._isSegPrefix(c.path, target)) {
            const n = c.path === '' ? 0 : c.path.split('/').length;
            if (n > bestLen) { bestLen = n; bestId = c.id; }
          }
        }
        return bestId;
      };
      this.$root.querySelectorAll('.node-wrap[data-kind="folder"]').forEach((w) => {
        const pid = longest(w.dataset.folder || '', w.dataset.id, true); // dossier : préfixe STRICT
        if (pid) w.dataset.source = pid;
      });
      this.$root.querySelectorAll('.node-wrap[data-kind="fileeditor"]').forEach((w) => {
        const f = w.dataset.file;
        if (!f) return; // éditeur sans fichier ouvert -> on garde son lien (override create->open)
        const pid = longest(window.MekiFolders.dirOf(f), w.dataset.id, false); // éditeur : égalité permise
        if (pid) w.dataset.source = pid;
      });
    },

    // Garantit la chaîne de dossiers nécessaire pour `filePath` (création incrémentale).
    // En compact, peut SCINDER : retire les dossiers éphémères que la nouvelle config ne désire plus.
    // Retourne la node dossier hôte du fichier (ou null si à la racine).
    async _ensureFolderChain(filePath, createdOut) {
      const dir = window.MekiFolders.dirOf(filePath);
      if (!dir) return null;
      const openFiles = this.openEditorFilePaths().concat([filePath]);
      const desired = window.MekiFolders.desiredFolders(openFiles, { compact: this._compactMode });
      const toCreate = desired.filter((p) => !this._hasFolderNode(p))
        .sort((a, b) => a.split('/').length - b.split('/').length);
      for (const p of toCreate) await this._createFolderNode(p, { createdOut }); // createdOut = dossiers créés (suivi par l'appelant)
      if (this._compactMode) {
        const want = new Set(desired);
        const stale = [...this.$root.querySelectorAll('.node-wrap[data-kind="folder"].ephemeral')]
          .filter((w) => !want.has(w.dataset.folder));
        for (const w of stale) await this._removeFolderNode(w);
      }
      this._refreshFolderClaims();
      this._recableFolders();
      this.drawCables(); // la disposition tidy est faite UNE fois par l'appelant (après l'ajout de l'éditeur)
      return this._findFolderForPath(filePath);
    },
    // Recalcule l'ensemble des nodes dossier désirés (déclaratif) — pour le toggle compact et le ménage.
    async reconcileFolderNodes() {
      const openFiles = this.openEditorFilePaths();
      const desired = new Set(window.MekiFolders.desiredFolders(openFiles, { compact: this._compactMode }));
      // garder les dossiers ÉPINGLÉS (sortis à la main) même hors de l'ensemble désiré
      this.$root.querySelectorAll('.node-wrap[data-kind="folder"]').forEach((w) => {
        if (!w.classList.contains('ephemeral')) desired.add(w.dataset.folder);
      });
      const toCreate = [...desired].filter((p) => p && !this._hasFolderNode(p))
        .sort((a, b) => a.split('/').length - b.split('/').length);
      for (const p of toCreate) await this._createFolderNode(p);
      const toRemove = [...this.$root.querySelectorAll('.node-wrap[data-kind="folder"].ephemeral')]
        .filter((w) => !desired.has(w.dataset.folder));
      for (const w of toRemove) await this._removeFolderNode(w);
      this._refreshFolderClaims();
      this._recableFolders();
      this.drawCables();
      this.fitView(); // structure changée : rien d'existant ne bouge, on redessine + cadre si ça déborde
    },

    // Sortie MANUELLE d'un dossier (clic-droit) -> node dossier ÉPINGLÉE (permanente).
    async openFolderAsNode(path) {
      if (!path || this._hasFolderNode(path)) return;
      await this._createFolderNode(path, { pinned: true });
      this._refreshFolderClaims();
      this._recableFolders();
      this.drawCables();
      this.fitView(); // structure changée : rien d'existant ne bouge, on redessine + cadre si ça déborde
    },

    // Fermeture explicite d'un node dossier (croix). cascade (shift) = ferme aussi les enfants.
    makeFolderClose(node) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'node-close-folder';
      btn.title = 'Fermer le dossier (shift = ferme aussi les fichiers)';
      btn.textContent = '✕';
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.closeFolderNode(node, btn.closest('.node-wrap'), e.shiftKey); });
      return btn;
    },
    async closeFolderNode(node, wrap, cascade) {
      if (!wrap) return;
      const children = [...this.$root.querySelectorAll('.node-wrap[data-source="' + wrap.dataset.id + '"]')];
      if (cascade) {
        const editors = children.filter((c) => c.dataset.kind === 'fileeditor');
        if (editors.length && !window.confirm('Fermer le dossier et ses ' + children.length + ' enfant(s) ?')) return;
        for (const c of children) {
          if (c.dataset.kind === 'folder') { await this.closeFolderNode({ id: c.dataset.id, kind: 'folder' }, c, true); }
          else { try { await fetch('/api/canvas/nodes/' + c.dataset.id, { method: 'DELETE' }); } catch (e) {} this._forgetEphemeral(c.dataset.id); c.remove(); }
        }
        try { await fetch('/api/canvas/nodes/' + wrap.dataset.id, { method: 'DELETE' }); } catch (e) {}
        wrap.remove();
      } else {
        await this._removeFolderNode(wrap); // non destructif : enfants rebranchés au grand-parent
      }
      this._refreshFolderClaims();
      this._recableFolders();
      this.drawCables();
      this.fitView(); // structure changée : rien d'existant ne bouge, on redessine + cadre si ça déborde
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
      if (c.type === 'chat') {
        const el = document.createElement('div');
        el.className = 'cmp-chat-host';
        this.mountChat(el, c, node);
        return el;
      }
      if (c.type === 'gitbranch') {
        // brique G : titre (⎇ branche, vue minimale gardée quand réduit) + détail (ahead/behind/modifs).
        const el = document.createElement('div');
        el.className = 'cmp-gitbranch';
        const title = document.createElement('div');
        title.className = 'gb-title';
        title.textContent = '⎇ …';
        const detail = document.createElement('div');
        detail.className = 'gb-detail';
        detail.textContent = '…';
        el.append(title, detail);
        return el;
      }
      // type inconnu : fallback visuel plutôt qu'un trou silencieux
      const el = document.createElement('div');
      el.className = 'cmp-unknown';
      el.textContent = c.type;
      return el;
    },

    // Monte la vue chat (window.MekiChatView) et l'indexe par node id pour pouvoir
    // la détruire (fermer la WS) au re-render / retrait (renderNodes/rerenderNode).
    mountChat(host, comp, node) {
      if (!window.MekiChatView || !window.MekiChat) {
        host.textContent = 'Chat indisponible (scripts non chargés).';
        return;
      }
      const view = window.MekiChatView.mount(host, comp.conversation_id, comp);
      if (node && node.id) this._chatViews[node.id] = view;
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
        // Brique G : masquage dérivé — un dossier qui possède déjà sa node est masqué ici (fs-claimed) ;
        // data-path permet de le re-révéler quand la node dossier est fermée.
        item.dataset.path = entry.path;
        if (this._hasFolderNode(entry.path)) item.classList.add('fs-claimed');
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
        // Brique G : clic-droit sur un dossier -> le SORTIR en node (mini-explorateur épinglé).
        row.addEventListener('contextmenu', (ev) => {
          if (this.tool !== 'select') return;
          ev.preventDefault();
          ev.stopPropagation();
          this.openFolderAsNode(entry.path);
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

    startPan(e) {
      // clic sur le fond vide : désélectionne + cache la mini-toolbar
      this.hideToolbar();
      this.$root.querySelectorAll('.node-wrap.selected').forEach((n) => n.classList.remove('selected'));
      this.selectedId = null;
      this.panning = true; this.last = { x: e.clientX, y: e.clientY };
    },
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
