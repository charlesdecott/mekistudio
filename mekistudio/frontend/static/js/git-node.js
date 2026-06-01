// Rendu PUR du contenu de la node « branch git » (brique G). `fmt*` sont des fonctions
// pures (testées `node --test`) ; `render` applique au DOM (titre = vue minimale gardée
// quand le node est réduit ; détail = ahead/behind/modifs, masqué quand réduit).
(function (root) {
  'use strict';

  function fmtTitle(info) {
    if (!info || !info.branch) return '⎇ —';
    return '⎇ ' + info.branch + (info.detached ? ' (détaché)' : '');
  }

  function fmtDetail(info) {
    if (!info || !info.branch) return 'pas un dépôt git';
    const parts = [];
    if (info.ahead != null && info.behind != null) {
      parts.push('↑' + info.ahead + ' ↓' + info.behind);
    }
    if (info.dirty != null) {
      parts.push(info.dirty > 0 ? '● ' + info.dirty + ' modif' + (info.dirty > 1 ? 's' : '') : '✓ propre');
    }
    return parts.join(' · ') || '—';
  }

  // Met à jour le DOM d'une node git (élément `.cmp-gitbranch`).
  function render(el, info) {
    if (!el) return;
    const t = el.querySelector('.gb-title');
    const d = el.querySelector('.gb-detail');
    if (t) t.textContent = fmtTitle(info);
    if (d) d.textContent = fmtDetail(info);
  }

  const MekiGitNode = { fmtTitle, fmtDetail, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiGitNode;
  if (typeof window !== 'undefined') root.MekiGitNode = MekiGitNode;
})(typeof window !== 'undefined' ? window : globalThis);
