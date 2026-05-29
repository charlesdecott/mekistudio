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
    panning: false,
    last: { x: 0, y: 0 },
    view: { x: 0, y: 0, zoom: 1 },
    _saveTimer: null,

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
      this.applyBox(wrap, node);
      wrap.appendChild(this.renderComponent(node.root));
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
      let moved = false;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', finish);
        if (moved) this.persistNode(node); // pas de POST sur un simple clic
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
      this.reloadCanvas();
    },
    async reloadCanvas() {
      let state = {};
      try { const r = await fetch('/api/canvas'); if (r.ok) state = await r.json(); } catch (e) {}
      this.renderNodes(state.nodes || []);
      // ré-applique la sélection (sinon l'engrenage du node configuré disparaît)
      if (this.selectedId) {
        const w = this.$root.querySelector('.node-wrap[data-id="' + this.selectedId + '"]');
        if (w) w.classList.add('selected');
      }
    },
    renderComponent(c) {
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
        (c.children || []).forEach((ch) => el.appendChild(this.renderComponent(ch)));
        return el;
      }
      if (c.type === 'node') {
        const el = document.createElement('div');
        el.className = 'cmp-node';
        (c.children || []).forEach((ch) => el.appendChild(this.renderComponent(ch)));
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
        row.addEventListener('click', (ev) => {
          if (this.tool !== 'select') return;
          ev.stopPropagation();
          this.$root.querySelectorAll('.fs-row.selected')
            .forEach((n) => n.classList.remove('selected'));
          row.classList.add('selected');
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
