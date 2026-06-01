// Géométrie PURE des dossiers-en-nodes (brique G). Zéro DOM -> testable `node --test`
// (invariant de pureté, comme cables.js/collision.js/chat-impulses.js).
//
// Calcule l'ensemble des chemins de dossiers à matérialiser en nodes à partir de la
// liste des fichiers ouverts : chaîne COMPLÈTE (un node par segment) ou COMPACTE
// (style VSCode : on fusionne les dossiers à enfant unique, on garde un dossier ssi
// il contient directement un fichier ouvert OU s'il est un point de branchement).
(function (root) {
  'use strict';

  function _norm(p) {
    return (p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  }

  // Dossier d'un fichier (posix relatif). "" si le fichier est à la racine du repo.
  function dirOf(filePath) {
    const segs = _norm(filePath).split('/').filter(Boolean);
    return segs.slice(0, -1).join('/');
  }

  // Tous les dossiers ancêtres de `dir` (lui inclus), du plus court au plus long.
  // Exclut la racine "" (c'est l'explorateur, pas un node dossier).
  function ancestors(dir) {
    const segs = _norm(dir).split('/').filter(Boolean);
    const out = [];
    for (let i = 1; i <= segs.length; i++) out.push(segs.slice(0, i).join('/'));
    return out;
  }

  function _parent(p) {
    return p.split('/').slice(0, -1).join('/');
  }

  // Ensemble des chemins de dossiers à matérialiser. `opts.compact` -> fusion VSCode.
  function desiredFolders(openFiles, opts) {
    opts = opts || {};
    // dossier direct de chaque fichier (les fichiers à la racine n'ont pas de node dossier)
    const dirs = (openFiles || []).map(dirOf).filter((d) => d !== '');
    const full = new Set();
    dirs.forEach((d) => ancestors(d).forEach((a) => full.add(a)));
    if (!opts.compact) return [...full].sort();

    // Compact : on garde un dossier F ssi un fichier ouvert est DIRECTEMENT dedans
    // (directFile) OU s'il a ≥2 enfants dans `full` (point de branchement). Les
    // intermédiaires à enfant unique et sans fichier sont fusionnés (supprimés).
    const directFile = new Set(dirs);
    const arr = [...full];
    const childCount = {};
    arr.forEach((p) => {
      const par = _parent(p);
      if (full.has(par)) childCount[par] = (childCount[par] || 0) + 1;
    });
    return arr
      .filter((F) => directFile.has(F) || (childCount[F] || 0) >= 2)
      .sort();
  }

  const MekiFolders = { dirOf, ancestors, desiredFolders };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiFolders;
  if (typeof window !== 'undefined') root.MekiFolders = MekiFolders;
})(typeof window !== 'undefined' ? window : globalThis);
