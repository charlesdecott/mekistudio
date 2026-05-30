// Mapping PUR event-wire -> intention d'impulsion (ou null). Zéro DOM -> testable `node --test`
// (invariant de pureté, comme cables.js/collision.js/chat-model.js). Reçoit un event ENRICHI : un
// tool_result complété par {name, file_path} (via toolsById, fait côté chat-view). Les `value` de
// cible sont les KINDS RÉELS du DOM ('chat', 'fileexplorer', 'fileeditor').
(function (root) {
  'use strict';

  const FILE_TOOLS = { Read: 1, Grep: 1 }; // portent un file_path -> comète vers le fichier
  const LIST_TOOLS = { Glob: 1, LS: 1 };   // listing -> glow explorateur

  function impulseFor(ev) {
    if (!ev) return null;
    switch (ev.type) {
      case 'tool_result':
        if (ev.is_error) return { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'error' };
        if (ev.name && FILE_TOOLS[ev.name] && ev.file_path) {
          return {
            kind: 'comet',
            target: { by: 'file', value: ev.file_path },
            level: 'strong',
            fallback: { kind: 'glow', target: { by: 'kind', value: 'fileexplorer' }, level: 'soft' },
          };
        }
        if (ev.name && LIST_TOOLS[ev.name]) {
          return { kind: 'glow', target: { by: 'kind', value: 'fileexplorer' }, level: 'soft' };
        }
        return null;
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

  const MekiImpulses = { impulseFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiImpulses;
  if (typeof window !== 'undefined') root.MekiImpulses = MekiImpulses;
})(typeof window !== 'undefined' ? window : globalThis);
