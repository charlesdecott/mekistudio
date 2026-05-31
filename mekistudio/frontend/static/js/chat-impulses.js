// Mapping PUR event-wire -> intention d'impulsion (ou null). Zéro DOM -> testable `node --test`
// (invariant de pureté, comme cables.js/collision.js/chat-model.js). Reçoit un event ENRICHI : un
// tool_result complété par {name, file_path} (via toolsById, fait côté chat-view). Les `value` de
// cible sont les KINDS RÉELS du DOM ('chat', 'fileexplorer', 'fileeditor').
(function (root) {
  'use strict';

  // Outils LECTURE : tous declenchent une comete. Avec un chemin precis (file_path enrichi depuis
  // input.file_path||input.path) -> comete vers l'editeur du fichier (repli explorateur). Sans chemin
  // (Grep repo-wide, Glob, LS) -> comete vers l'explorateur. NB : Grep porte son chemin dans `path`,
  // pas `file_path` (cf. backend guard.py) -> l'enrichissement chat-view doit fournir input.path.
  const READ_TOOLS = { Read: 1, Grep: 1, Glob: 1, LS: 1 };

  // Match d'un fichier d'editeur (chemin RELATIF repo) avec un chemin lu (relatif, ./, ou ABSOLU) :
  // egalite, sinon le chemin lu finit-il par les SEGMENTS du chemin editeur (suffixe). Pur.
  function _norm(p) { return (p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''); }
  function fileMatch(editorFile, readPath) {
    const have = _norm(editorFile), want = _norm(readPath);
    if (!have || !want) return false;
    if (have === want) return true;
    const A = want.split('/').filter(Boolean), B = have.split('/').filter(Boolean);
    if (!B.length || B.length > A.length) return false;
    for (let i = 1; i <= B.length; i++) if (A[A.length - i] !== B[B.length - i]) return false;
    return true;
  }

  function impulseFor(ev) {
    if (!ev) return null;
    switch (ev.type) {
      case 'tool_result':
        if (ev.is_error) return { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'error' };
        if (!ev.name || !READ_TOOLS[ev.name]) return null;
        if (ev.file_path) {
          return {
            kind: 'comet',
            target: { by: 'file', value: ev.file_path },
            level: 'strong',
            // pas d'éditeur ouvert pour ce fichier -> la comète VOYAGE quand même vers l'explorateur
            // (et non un simple glow) : on veut voir l'impulsion se déplacer, comme le mode debug ⚡.
            fallback: { kind: 'comet', target: { by: 'kind', value: 'fileexplorer' }, level: 'strong' },
          };
        }
        // outil fichier sans chemin précis -> comète douce vers l'explorateur (toujours visible)
        return { kind: 'comet', target: { by: 'kind', value: 'fileexplorer' }, level: 'soft' };
      case 'turn_end':
        return { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'strong', dismissable: true };
      case 'hook_fired':
        if (ev.name === 'Notification') {
          return { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'notif', dismissable: true };
        }
        return null;
      default:
        return null;
    }
  }

  const MekiImpulses = { impulseFor, fileMatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiImpulses;
  if (typeof window !== 'undefined') root.MekiImpulses = MekiImpulses;
})(typeof window !== 'undefined' ? window : globalThis);
