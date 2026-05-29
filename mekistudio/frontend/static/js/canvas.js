// Composant Alpine du canvas. On l'enregistre via l'événement `alpine:init`
// (et ce script est chargé AVANT celui d'Alpine) : sinon course de démarrage —
// Alpine boote dès que le DOM est parsé (scripts `defer`, readyState
// "interactive") et évaluerait `x-data="canvas"` avant que ce fichier ne
// définisse le composant => "canvas is not a function".
document.addEventListener('alpine:init', () => {
  Alpine.data('canvas', () => ({
    projectName: window.__PROJECT_NAME__ || 'mekistudio',
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
      if (state.viewport) this.view = state.viewport;
      this.renderNodes(state.nodes || []);
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
      wrap.style.left = (node.x || 0) + 'px';
      wrap.style.top = (node.y || 0) + 'px';
      wrap.dataset.kind = node.kind || '';
      wrap.appendChild(this.renderComponent(node.root));
      return wrap;
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
      // type inconnu : fallback visuel plutôt qu'un trou silencieux
      const el = document.createElement('div');
      el.className = 'cmp-unknown';
      el.textContent = c.type;
      return el;
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
