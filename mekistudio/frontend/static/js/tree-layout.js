// Layout d'arbre « tidy » PUR (brique G — lisibilité de l'intrication dossiers→fichier).
// Zéro DOM -> testable `node --test` (comme cables.js/collision.js/folders.js).
//
// Place le sous-arbre d'un node racine (l'explorateur) en COLONNES par profondeur (x croît
// vers la droite) et empile les frères verticalement ; chaque parent est CENTRÉ sur ses
// enfants (Reingold-Tilford simplifié). Résultat : une chaîne dossier→…→fichier se lit comme
// une ligne horizontale, une bifurcation fourche proprement -> on suit facilement jusqu'au fichier.
(function (root) {
  'use strict';

  // items : [{ id, parent, w, h, sortKey }] (parent = id du parent, ou rootId pour les enfants directs).
  // opts  : { col, row, rootX, rootCy }. Retourne { id: {x, y} } en coin haut-gauche.
  function layoutTree(items, rootId, opts) {
    const col = opts.col, row = opts.row;
    const byId = new Map(items.map((it) => [it.id, it]));
    const children = new Map();
    for (const it of items) {
      if (!children.has(it.parent)) children.set(it.parent, []);
      children.get(it.parent).push(it);
    }
    const sortKids = (arr) => arr.slice().sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

    // Post-ordre : chaque feuille prend un créneau vertical séquentiel ; chaque interne est
    // centré sur la moyenne des centres de ses enfants (bandes verticales disjointes -> pas de
    // recouvrement entre sous-arbres, pas de croisement de câbles).
    const cy = new Map();
    let leafY = 0;
    const seen = new Set();
    const visit = (it) => {
      if (seen.has(it.id)) return; // garde anti-cycle (arbre normalement)
      seen.add(it.id);
      const kids = sortKids(children.get(it.id) || []);
      if (!kids.length) { cy.set(it.id, leafY); leafY += row; return; }
      kids.forEach(visit);
      cy.set(it.id, (cy.get(kids[0].id) + cy.get(kids[kids.length - 1].id)) / 2);
    };
    sortKids(children.get(rootId) || []).forEach(visit);

    // profondeur (racine = 0 ; enfants directs = 1 ; …)
    const depthOf = (it) => {
      let d = 1, cur = it; const guard = new Set();
      while (cur.parent !== rootId && byId.has(cur.parent) && !guard.has(cur.id)) {
        guard.add(cur.id); cur = byId.get(cur.parent); d++;
      }
      return d;
    };

    const cys = [...cy.values()];
    const mid = cys.length ? (Math.min(...cys) + Math.max(...cys)) / 2 : 0;
    const out = {};
    for (const it of items) {
      if (!cy.has(it.id)) continue; // hors du sous-arbre de la racine
      out[it.id] = {
        x: opts.rootX + depthOf(it) * col,
        y: (cy.get(it.id) - mid) + opts.rootCy - it.h / 2, // cy = CENTRE -> coin haut-gauche
      };
    }
    return out;
  }

  const MekiTreeLayout = { layoutTree };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiTreeLayout;
  if (typeof window !== 'undefined') root.MekiTreeLayout = MekiTreeLayout;
})(typeof window !== 'undefined' ? window : globalThis);
