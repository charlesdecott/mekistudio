# Node chat — hooks → impulsions (Spec 1 : F1 + F2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capter les hooks Claude Code du node chat, les afficher dans un volet « hooks » repliable, et déclencher les impulsions déjà livrées (comète/glow) sur les nodes **existants**.

**Architecture:** Backend — des hooks émetteurs (même mécanisme `HookMatcher` que le guard) appellent `on_hook(name, data)` ; le bridge diffuse `hook_fired`/`turn_end`/`attached` (**transients, non persistés**). Front — un module **pur** `chat-impulses.js` mappe un event → une intention `{kind, target, level}` ; `chat-view.js` enrichit/dispatch, `canvas.js` résout le node cible et déclenche `animateComet`/`glow`. Un marqueur `attached` sépare le **replay** (pas d'impulsion) du **live**.

**Tech Stack:** Python 3.11 / asyncio / Claude Agent SDK (`HookMatcher`) · JS classique (modules purs testés `node --test`, comme `cables.js`/`collision.js`/`chat-model.js`) · pytest · Playwright.

**Spec:** `docs/superpowers/specs/2026-05-30-node-chat-hooks-impulsions-design.md`

---

## Structure des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `mekistudio/backend/chat/events.py` | builders d'events | + `hook_fired`, `turn_end`, `attached` (transients) |
| `mekistudio/backend/chat/bridge.py` | moteur conversation | + `_emit_hook`, `turn_end` dans `_end_turn`, `attached` dans `attach`, passe `on_hook` à `build_options` |
| `mekistudio/backend/chat/options.py` | options SDK + adaptateur | + `make_hook_emitter`, `build_options(..., on_hook)` enregistre les émetteurs |
| `mekistudio/frontend/static/js/chat-impulses.js` | **(nouveau)** mapping PUR event→intention | créer |
| `mekistudio/frontend/static/js/chat-impulses.test.js` | **(nouveau)** tests `node --test` | créer |
| `mekistudio/frontend/static/js/chat-view.js` | vue DOM du chat | + flag `live`, dispatch `meki:impulse`, volet « hooks » |
| `mekistudio/frontend/static/js/canvas.js` | canvas impératif | + `pulseTo`, écoute `meki:impulse`, `data-file` éditeur, glow `error`, clic = dismiss |
| `mekistudio/frontend/static/css/canvas.css` | styles | + volet hooks, `.glow-error` |
| `mekistudio/frontend/templates/canvas.html` | ordre de chargement | charge `chat-impulses.js` avant `canvas.js` |
| `tests/unit/test_chat_events.py` | tests events | + transients hors `DURABLE_TYPES` |
| `tests/unit/test_chat_bridge.py` | tests bridge | + `turn_end`, `attached`, `_emit_hook` |
| `tests/unit/test_chat_options.py` | **(nouveau)** tests options | `make_hook_emitter` |
| `tests/integration/test_sdk_hooks_smoke.py` | **(nouveau)** smoke réel | pinne l'API hooks |
| `scripts/pw-chat-impulses.mjs` | **(nouveau)** validation Playwright | créer |

---

## Task 1 : events transients `hook_fired` / `turn_end` / `attached`

**Files:**
- Modify: `mekistudio/backend/chat/events.py`
- Test: `tests/unit/test_chat_events.py`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `tests/unit/test_chat_events.py` :

```python
from mekistudio.backend.chat import events


def test_hook_turn_attached_are_transient():
    hf = events.hook_fired("PostToolUse", {"tool_name": "Read"})
    te = events.turn_end("success")
    at = events.attached()
    assert hf == {"type": "hook_fired", "name": "PostToolUse", "data": {"tool_name": "Read"}}
    assert te == {"type": "turn_end", "status": "success"}
    assert at == {"type": "attached"}
    # transients : JAMAIS persistés (pas de seq attribué par le store)
    for t in ("hook_fired", "turn_end", "attached"):
        assert t not in events.DURABLE_TYPES
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `uv run pytest tests/unit/test_chat_events.py::test_hook_turn_attached_are_transient -v`
Expected: FAIL (`AttributeError: module ... has no attribute 'hook_fired'`).

- [ ] **Step 3 : Implémenter**

Ajouter à la fin de `mekistudio/backend/chat/events.py` (après `message_stop`/`cleared`, dans la section transients) :

```python
# --- hooks & fin de tour (transients, wire only ; brique F) ---
def hook_fired(name: str, data: dict) -> dict:
    return {"type": "hook_fired", "name": name, "data": data}


def turn_end(status: str) -> dict:
    return {"type": "turn_end", "status": status}


def attached() -> dict:
    # marqueur de fin de replay : les events APRÈS sont 'live' -> le front déclenche les impulsions
    return {"type": "attached"}
```

Ne PAS toucher `DURABLE_TYPES` (ces trois types restent transients).

- [ ] **Step 4 : Lancer le test**

Run: `uv run pytest tests/unit/test_chat_events.py -v`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/chat/events.py tests/unit/test_chat_events.py
git commit -m "feat(chat/events): hook_fired, turn_end, attached (transients brique F)"
```

---

## Task 2 : le bridge diffuse `turn_end` (fin de tour) et `attached` (fin de replay)

**Files:**
- Modify: `mekistudio/backend/chat/bridge.py` (`_end_turn` ~l.203-221 ; `attach` ~l.224-243)
- Test: `tests/unit/test_chat_bridge.py`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `tests/unit/test_chat_bridge.py` (après les tests brique D) :

```python
async def test_turn_end_broadcast_not_persisted(tmp_path):
    store = ConversationStore(tmp_path, "cte")
    script = [
        {"kind": "message_start"}, {"kind": "delta", "text": "ok"},
        {"kind": "assistant", "text": "ok", "tools": []},
        {"kind": "result", "subtype": "success", "session_id": "s"},
    ]
    bridge = ChatBridge("cte", store, _factory([script]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("salut")
    te = await _drain_until(q, "turn_end")
    assert te["status"] == "success"
    recs = await store.read_since(0)
    assert all(r["type"] != "turn_end" for r in recs)  # transient : jamais persisté
    await bridge.shutdown()


async def test_attached_marker_after_replay(tmp_path):
    store = ConversationStore(tmp_path, "cat")
    await store.append(events.user_message("vieux message"))  # historique à rejouer
    bridge = ChatBridge("cat", store, _factory([]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    seen = []
    for _ in range(5):
        seen.append((await asyncio.wait_for(q.get(), 2.0))["type"])
        if seen[-1] == "attached":
            break
    assert "user_message" in seen
    assert seen[-1] == "attached"  # le marqueur arrive APRÈS le replay
    await bridge.shutdown()
```

`events` est déjà importable ? Ajouter en haut du fichier de test si absent : `from mekistudio.backend.chat import events`.

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `uv run pytest tests/unit/test_chat_bridge.py -k "turn_end or attached" -v`
Expected: FAIL (pas de `turn_end`/`attached` émis → `asyncio.TimeoutError`).

- [ ] **Step 3 : Implémenter**

Dans `mekistudio/backend/chat/bridge.py`, méthode `_end_turn`, juste APRÈS la boucle de balayage des orphelins et AVANT le `if self._pending:` :

```python
            for tid in self._turn_tool_ids - self._turn_tool_results:
                tr = await self._store.append(events.tool_result(tid, "interrompu", True))
                self._broadcast(tr)
            # fin de tour visible (brique F : déclenche le glow 'Stop'). Transient.
            self._broadcast(events.turn_end("interrupted" if self._stop_requested else "success"))
            if self._pending:  # enchaînement de la file
```

Dans `attach`, à la fin de la section critique, juste AVANT `self._subscribers.add(queue)` :

```python
            if self._state == "running" and self._in_flight is not None:
                queue.put_nowait(events.message_start(self._in_flight["message_id"]))
                queue.put_nowait(events.text_delta(self._in_flight["message_id"], self._in_flight["text"]))
            # tout ce qui précède = replay/catch-up ; les events SUIVANTS sont 'live' (brique F)
            queue.put_nowait(events.attached())
            self._subscribers.add(queue)
```

- [ ] **Step 4 : Lancer les tests**

Run: `uv run pytest tests/unit/test_chat_bridge.py -v`
Expected: PASS (tous, y compris les nouveaux).

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/chat/bridge.py tests/unit/test_chat_bridge.py
git commit -m "feat(chat/bridge): turn_end (fin de tour) + attached (fin de replay), transients"
```

---

## Task 3 : capture des hooks (`make_hook_emitter` + `on_hook` → `hook_fired`)

**Files:**
- Modify: `mekistudio/backend/chat/options.py`, `mekistudio/backend/chat/bridge.py`
- Test: `tests/unit/test_chat_options.py` (nouveau), `tests/unit/test_chat_bridge.py`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/unit/test_chat_options.py` :

```python
from mekistudio.backend.chat.options import make_hook_emitter


async def test_hook_emitter_calls_on_hook_and_allows():
    seen = []
    emit = make_hook_emitter("PostToolUse", lambda name, data: seen.append((name, data)))
    out = await emit({"tool_name": "Read", "tool_input": {"file_path": "a.py"}}, "tid", None)
    assert out == {}  # n'influence pas la permission
    assert seen == [("PostToolUse", {"tool_name": "Read", "tool_input": {"file_path": "a.py"}})]


async def test_hook_emitter_never_raises():
    def boom(name, data):
        raise RuntimeError("x")
    emit = make_hook_emitter("Stop", boom)
    assert await emit({}, "tid", None) == {}  # avale l'erreur


async def test_hook_emitter_tolerates_none_on_hook():
    emit = make_hook_emitter("Stop", None)
    assert await emit({}, "tid", None) == {}
```

Ajouter à `tests/unit/test_chat_bridge.py` :

```python
async def test_emit_hook_broadcasts_hook_fired_not_persisted(tmp_path):
    store = ConversationStore(tmp_path, "chk")
    bridge = ChatBridge("chk", store, _factory([]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    bridge._emit_hook("Notification", {"message": "coucou"})
    ev = await _drain_until(q, "hook_fired")
    assert ev["name"] == "Notification" and ev["data"] == {"message": "coucou"}
    recs = await store.read_since(0)
    assert all(r["type"] != "hook_fired" for r in recs)  # transient
    await bridge.shutdown()
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `uv run pytest tests/unit/test_chat_options.py tests/unit/test_chat_bridge.py -k "hook_emitter or emit_hook" -v`
Expected: FAIL (`make_hook_emitter` inexistant ; `_emit_hook` inexistant).

- [ ] **Step 3 : Implémenter — `options.py`**

Dans `mekistudio/backend/chat/options.py`, ajouter avant `build_options` :

```python
def make_hook_emitter(name: str, on_hook):
    """Hook 'émetteur' : signale le hook au bridge via on_hook(name, data), sans rien bloquer.
    Renvoie {} (n'influence pas la permission) et NE LÈVE JAMAIS. Même mécanisme HookMatcher que
    le guard (prouvé en brique D)."""
    async def emit(input_data, tool_use_id, context):
        try:
            if on_hook is not None:
                on_hook(name, input_data or {})
        except Exception:
            pass
        return {}

    return emit
```

Remplacer la signature et le bloc `hooks=` de `build_options` :

```python
def build_options(repo_root: Path, store: ConversationStore, on_hook=None) -> Any:
    """ClaudeAgentOptions : outils LECTURE SEULE confinés (hook PreToolUse), streaming, + hooks
    émetteurs (brique F) qui signalent les hooks au bridge via on_hook (transient, non persisté)."""
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

    from mekistudio.backend.chat.guard import make_repo_guard

    root = Path(repo_root) if repo_root is not None else Path.cwd()
    # PreToolUse : le guard d'ABORD (confinement, un deny gagne), puis l'émetteur (visibilité).
    hooks = {
        "PreToolUse": [HookMatcher(matcher=None, hooks=[make_repo_guard(root), make_hook_emitter("PreToolUse", on_hook)])],
    }
    for hk in ("PostToolUse", "Stop", "Notification", "UserPromptSubmit", "SubagentStop", "PreCompact"):
        hooks[hk] = [HookMatcher(matcher=None, hooks=[make_hook_emitter(hk, on_hook)])]
    return ClaudeAgentOptions(
        cwd=str(root),
        tools=READ_ONLY_TOOLS,
        allowed_tools=READ_ONLY_TOOLS,
        permission_mode="default",
        hooks=hooks,
        setting_sources=[],
        include_partial_messages=True,
        resume=store.meta().get("claude_session_id"),
    )
```

- [ ] **Step 4 : Implémenter — `bridge.py`**

Dans `mekistudio/backend/chat/bridge.py`, méthode `start`, remplacer l'appel `build_options` pour passer `on_hook` :

```python
            options = build_options(self._repo_root, self._store, self._emit_hook)
```

Ajouter la méthode (à côté de `_broadcast`) :

```python
    def _emit_hook(self, name: str, data: dict) -> None:
        """Appelé par un hook émetteur (même boucle asyncio que _consume) -> diffuse un hook_fired
        transient. put_nowait non bloquant -> pas de verrou requis (cohérent avec le guard)."""
        self._broadcast(events.hook_fired(name, dict(data) if isinstance(data, dict) else {"raw": data}))
```

- [ ] **Step 5 : Lancer les tests**

Run: `uv run pytest tests/unit/test_chat_options.py tests/unit/test_chat_bridge.py -v`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add mekistudio/backend/chat/options.py mekistudio/backend/chat/bridge.py tests/unit/test_chat_options.py tests/unit/test_chat_bridge.py
git commit -m "feat(chat): capture des hooks (make_hook_emitter + on_hook -> hook_fired transient)"
```

---

## Task 4 : smoke — pinner l'API hooks réelle (intégration)

**Files:**
- Create: `tests/integration/test_sdk_hooks_smoke.py`

- [ ] **Step 1 : Écrire le smoke**

Créer `tests/integration/test_sdk_hooks_smoke.py` (modelé sur `test_sdk_tools_smoke.py`) :

```python
"""Smoke RÉEL (API Claude) : quels hooks émettent en session lecture seule + forme de leur data.
Pinne l'API hooks de la brique F (comme le smoke outils pinne l'API tool). Déselectionné par défaut
(`-m integration`). Documente le réel via les prints ; assertions minimales sur ce qu'on garantit."""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from mekistudio.backend.chat.bridge import ChatBridge
from mekistudio.backend.chat.options import default_client_factory
from mekistudio.backend.chat.store import ConversationStore

REPO = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.integration


async def _run(tmp_path):
    store = ConversationStore(tmp_path, "hooks")
    seen_hooks = []  # (name, keys)
    bridge = ChatBridge("hooks", store, default_client_factory, repo_root=REPO)
    # intercepte on_hook : enregistre nom + clés de data
    orig_emit = bridge._emit_hook

    def spy(name, data):
        seen_hooks.append((name, sorted((data or {}).keys())))
        orig_emit(name, data)

    bridge._emit_hook = spy
    await bridge.start()
    assert bridge.state != "error", bridge._error_message
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("Avec l'outil Read, lis le fichier CLAUDE.md. Puis réponds en un mot.")
    for _ in range(240):
        await asyncio.sleep(0.5)
        if bridge.state == "idle":
            break
    await bridge.shutdown()
    return seen_hooks


def test_hooks_api_shapes(tmp_path):
    seen = asyncio.run(_run(tmp_path))
    print("\n=== HOOKS REÇUS (name, clés de data) ===")
    for name, keys in seen:
        print(f"  {name}: {keys}")
    names = {n for n, _ in seen}
    # Ce qu'on GARANTIT : au moins PreToolUse émet (l'émetteur tourne à côté du guard).
    assert "PreToolUse" in names, f"hooks vus: {names}"
    # Documente (sans bloquer) si PostToolUse / Stop émettent réellement.
    print("PostToolUse émis:", "PostToolUse" in names, "| Stop émis:", "Stop" in names)
```

- [ ] **Step 2 : Lancer le smoke (réel)**

Run: `uv run pytest tests/integration/test_sdk_hooks_smoke.py -m integration -s -v`
Expected: PASS, et la sortie imprime la liste réelle des hooks + leurs clés `data`. **Noter** dans le commit quels hooks émettent (PostToolUse, Stop…) et la forme de `data` (clé du nom d'outil : `tool_name` ? `tool_input.file_path` ?). Si `PreToolUse` n'apparaît PAS (l'émetteur ne tourne pas à côté du guard), repli : un seul hook PreToolUse `[guard_qui_émet]` — voir note en fin de plan.

- [ ] **Step 3 : Commit**

```bash
git add tests/integration/test_sdk_hooks_smoke.py
git commit -m "test(chat): smoke d'API hooks (pinne quels hooks émettent + forme de data)"
```

---

## Task 5 : module pur `chat-impulses.js` (mapping event → intention)

**Files:**
- Create: `mekistudio/frontend/static/js/chat-impulses.js`, `mekistudio/frontend/static/js/chat-impulses.test.js`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `mekistudio/frontend/static/js/chat-impulses.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const MekiImpulses = require('./chat-impulses.js');

test('tool_result Read réussi -> comète vers le fichier (fallback glow explorateur)', () => {
  const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Read', file_path: 'a.py' });
  assert.equal(i.kind, 'comet');
  assert.deepEqual(i.target, { by: 'file', value: 'a.py' });
  assert.equal(i.level, 'strong');
  assert.deepEqual(i.fallback, { kind: 'glow', target: { by: 'kind', value: 'fileexplorer' }, level: 'soft' });
});

test('tool_result Grep réussi -> comète vers le fichier', () => {
  const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Grep', file_path: 'b.py' });
  assert.equal(i.kind, 'comet');
  assert.equal(i.target.value, 'b.py');
});

test('tool_result Glob / LS -> glow doux explorateur', () => {
  for (const name of ['Glob', 'LS']) {
    const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name });
    assert.deepEqual(i, { kind: 'glow', target: { by: 'kind', value: 'fileexplorer' }, level: 'soft' });
  }
});

test('tool_result en erreur -> flash rouge sur le chat', () => {
  const i = MekiImpulses.impulseFor({ type: 'tool_result', is_error: true, name: 'Read', file_path: 'x' });
  assert.deepEqual(i, { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'error' });
});

test('turn_end -> glow fort chat, dismissable', () => {
  const i = MekiImpulses.impulseFor({ type: 'turn_end', status: 'success' });
  assert.deepEqual(i, { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'strong', dismissable: true });
});

test('hook_fired Notification -> glow-notif chat, dismissable', () => {
  const i = MekiImpulses.impulseFor({ type: 'hook_fired', name: 'Notification', data: {} });
  assert.deepEqual(i, { kind: 'glow', target: { by: 'kind', value: 'chat' }, level: 'notif', dismissable: true });
});

test('events sans impulsion -> null', () => {
  assert.equal(MekiImpulses.impulseFor({ type: 'hook_fired', name: 'PostToolUse', data: {} }), null);
  assert.equal(MekiImpulses.impulseFor({ type: 'tool_use', id: 'x' }), null);
  assert.equal(MekiImpulses.impulseFor({ type: 'message_stop' }), null);
  assert.equal(MekiImpulses.impulseFor({ type: 'tool_result', is_error: false, name: 'Read' }), null); // pas de file_path
  assert.equal(MekiImpulses.impulseFor(null), null);
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `node --test mekistudio/frontend/static/js/chat-impulses.test.js`
Expected: FAIL (`Cannot find module './chat-impulses.js'`).

- [ ] **Step 3 : Implémenter**

Créer `mekistudio/frontend/static/js/chat-impulses.js` :

```js
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
```

- [ ] **Step 4 : Lancer le test**

Run: `node --test mekistudio/frontend/static/js/chat-impulses.test.js`
Expected: PASS (toutes les assertions).

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/chat-impulses.js mekistudio/frontend/static/js/chat-impulses.test.js
git commit -m "feat(chat/front): chat-impulses.js (mapping pur event->intention d'impulsion)"
```

---

## Task 6 : `canvas.js` consomme les intentions (impulsions sur nodes existants)

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (`renderNode` ~l.79-93 ; `firePulse` ~l.485-505 ; `glow`/`clearGlow` ~l.567-583 ; l'`init` du composant), `mekistudio/frontend/static/css/canvas.css`

> **Note de test :** `canvas.js` est **impératif/DOM** (non testé `node --test`, comme l'établit le projet — seules les géométries pures le sont). Cette tâche est validée par **Playwright** (Task 9). Garder la LOGIQUE testable dans `chat-impulses.js` (Task 5) ; ici, uniquement résolution DOM + animation.

- [ ] **Step 1 : `data-file` sur les éditeurs** — dans `renderNode`, après la ligne `wrap.dataset.source = ...` :

```js
      wrap.dataset.source = node.source_id || ''; // graphe de câbles lu depuis le DOM
      if (node.kind === 'fileeditor') wrap.dataset.file = (node.root && node.root.file_path) || '';
```

- [ ] **Step 2 : `glow`/`clearGlow` connaissent le niveau `error`** — dans `glow(id, level, ms)` ET `clearGlow(id)`, remplacer la liste de classes retirées pour inclure `glow-error` :

```js
      wrap.classList.remove('glow-soft', 'glow-strong', 'glow-notif', 'glow-error');
```

- [ ] **Step 3 : factoriser `pulseTo` + ajouter le handler d'impulsion**

Remplacer le corps de `firePulse(fromId)` pour déléguer à un nouveau `pulseTo`, et ajouter `pulseTo` + les helpers. `firePulse` devient :

```js
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
    // cible au niveau `arrivalLevel`. Verrou anti-chevauchement partagé (_pulsing).
    async pulseTo(fromId, toId, arrivalLevel) {
      if (this._pulsing || !fromId || !toId || fromId === toId) return;
      const boxes = this.nodeBoxes();
      const byId = {};
      boxes.forEach((info, id) => { byId[id] = { id, source: info.source || null }; });
      const path = window.MekiCables.pathBetween(byId, fromId, toId);
      if (!path || !path.length) return;
      this._pulsing = true;
      try {
        for (const seg of path) {
          await this.animateComet(seg);
          const arrived = seg.dir === 'up' ? seg.parentId : seg.childId;
          if (arrived !== toId) this.glow(arrived, 'soft', 600);
        }
        this.glow(toId, arrivalLevel || 'strong', 1500);
      } finally {
        this._pulsing = false;
      }
    },

    kindId(kind) {
      const w = this.$root.querySelector('.node-wrap[data-kind="' + kind + '"]');
      return w ? w.dataset.id : null;
    },

    editorIdForFile(filePath) {
      const norm = (p) => (p || '').replace(/\\/g, '/').replace(/^\.\//, '');
      const want = norm(filePath);
      if (!want) return null;
      const wraps = this.$root.querySelectorAll('.node-wrap[data-kind="fileeditor"]');
      for (const w of wraps) if (norm(w.dataset.file) === want) return w.dataset.id;
      return null;
    },

    // Glow + clic sur le node = extinction (acquittement). Capture pour passer AVANT les
    // stopPropagation internes du chat.
    glowDismissable(id, level, ms) {
      this.glow(id, level, ms);
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      if (!wrap) return;
      const off = () => { this.clearGlow(id); wrap.removeEventListener('click', off, true); };
      wrap.addEventListener('click', off, true);
    },

    // Exécute une intention d'impulsion (issue de MekiImpulses.impulseFor).
    applyIntent(intent) {
      if (!intent) return;
      if (intent.kind === 'comet') {
        const chatId = this.kindId('chat');
        const toId = this.editorIdForFile(intent.target.value);
        if (chatId && toId) { this.pulseTo(chatId, toId, intent.level === 'strong' ? 'strong' : 'soft'); return; }
        if (intent.fallback) this.applyIntent(intent.fallback);
        return;
      }
      const id = intent.target.by === 'kind' ? this.kindId(intent.target.value) : intent.target.value;
      if (!id) return;
      const ms = intent.level === 'notif' ? 0 : 1500; // soft=600 plus bas
      const dur = intent.level === 'soft' ? 600 : ms;
      if (intent.dismissable) this.glowDismissable(id, intent.level, dur);
      else this.glow(id, intent.level, dur);
    },
```

- [ ] **Step 4 : enregistrer l'écoute** — dans l'`init()` du composant canvas (là où sont posés les autres `document.addEventListener`, ex. après le setup du drag), ajouter :

```js
      document.addEventListener('meki:impulse', (e) => this.applyIntent(e.detail));
```

- [ ] **Step 5 : CSS `.glow-error`** — dans `mekistudio/frontend/static/css/canvas.css`, à côté des règles `.glow-soft/.glow-strong/.glow-notif`, ajouter :

```css
.node-wrap.glow-error {
  box-shadow: 0 0 0 2px #e5484d, 0 0 18px 4px rgba(229, 72, 77, 0.55);
  transition: box-shadow 0.2s ease;
}
```

- [ ] **Step 6 : Vérifier la syntaxe**

Run: `node -c mekistudio/frontend/static/js/canvas.js`
Expected: aucune sortie (syntaxe OK).

- [ ] **Step 7 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js mekistudio/frontend/static/css/canvas.css
git commit -m "feat(canvas): consomme meki:impulse (comète chat->éditeur, glow, clic=dismiss)"
```

---

## Task 7 : `chat-view.js` — flag `live` + dispatch des impulsions

**Files:**
- Modify: `mekistudio/frontend/static/js/chat-view.js`

> Validé par Playwright (Task 9). La logique de mapping est déjà testée (Task 5).

- [ ] **Step 1 : flag `live`** — dans `mount(...)`, à côté des autres variables d'état (près de `let generation = 0;`), ajouter :

```js
    let live = false; // passe true au marqueur 'attached' -> on ne déclenche PAS d'impulsion au replay
```

Dans `connect()`, au début (à la (re)connexion), réinitialiser : juste après `const myGen = ++generation;` ajouter `live = false;`.

- [ ] **Step 2 : router `attached` + dispatcher les impulsions** — dans le handler `ws.addEventListener('message', ...)`, avant `applyEvent(ev)`, gérer le marqueur, et faire émettre les impulsions par `applyEvent`. Remplacer le corps du handler :

```js
      ws.addEventListener('message', (e) => {
        if (myGen !== generation) return;
        const ev = JSON.parse(e.data);
        if (ev.type === 'cleared') { rotateTo(ev.conversation_id); return; }
        if (ev.type === 'attached') { live = true; return; }
        applyEvent(ev);
      });
```

Dans `applyEvent(ev)`, après `MekiChat.reduce(state, ev);` et la logique de rendu existante, ajouter l'appel d'impulsion (uniquement en live) — à la toute fin de la fonction, avant le `render()` final ou juste après `MekiChat.reduce` :

```js
    function applyEvent(ev) {
      MekiChat.reduce(state, ev);
      if (live) maybeImpulse(ev); // déclenche les comètes/glows seulement en live (pas au replay)
      // fast-path streaming : markdown live de la SEULE bulle en vol (throttlé).
      if (ev.type === 'text_delta' && streamEl && streamMid === ev.message_id && state.inFlight) {
        scheduleStreamRender();
        return;
      }
      render();
    }

    // Enrichit un tool_result avec {name, file_path} (via toolsById), mappe vers une intention pure,
    // et la dispatch au canvas. (tool_result ne porte que {id, output, is_error}.)
    function maybeImpulse(ev) {
      let e = ev;
      if (ev.type === 'tool_result') {
        const t = state.toolsById[ev.id];
        e = {
          type: 'tool_result',
          is_error: !!ev.is_error,
          name: t && t.name,
          file_path: t && t.input && t.input.file_path,
        };
      }
      const intent = window.MekiImpulses && window.MekiImpulses.impulseFor(e);
      if (intent) document.dispatchEvent(new CustomEvent('meki:impulse', { detail: intent }));
    }
```

- [ ] **Step 3 : Vérifier la syntaxe**

Run: `node -c mekistudio/frontend/static/js/chat-view.js`
Expected: aucune sortie.

- [ ] **Step 4 : Commit**

```bash
git add mekistudio/frontend/static/js/chat-view.js
git commit -m "feat(chat/front): dispatch des impulsions en live (flag attached, enrich tool_result)"
```

---

## Task 8 : `chat-view.js` — volet « hooks » repliable (F1)

**Files:**
- Modify: `mekistudio/frontend/static/js/chat-view.js`, `mekistudio/frontend/static/css/canvas.css`

- [ ] **Step 1 : DOM du volet** — dans `mount(...)`, après la création de `list`/`chips`/`composer` et avant `wrap.append(...)`, créer un volet repliable :

```js
    const hooksBar = el('div', 'chat-hooks');
    const hooksHead = el('div', 'chat-hooks-head');
    hooksHead.textContent = '🪝 hooks';
    const hooksLog = el('div', 'chat-hooks-log');
    hooksBar.append(hooksHead, hooksLog);
    hooksHead.addEventListener('click', () => hooksBar.classList.toggle('open'));
```

Inclure `hooksBar` dans l'append du wrap (après `chips`, avant `composer`) :

```js
    wrap.append(header, statusBar, list, chips, hooksBar, composer);
```

Et empêcher le node-wrap parent de capter les clics : ajouter `hooksBar` à la liste des `mousedown` stoppés :

```js
    [composer, header, statusBar, chips, hooksBar].forEach((e) =>
      e.addEventListener('mousedown', (ev) => ev.stopPropagation())
    );
```

- [ ] **Step 2 : alimenter le volet** — ajouter une fonction et l'appeler dans `applyEvent` pour les `hook_fired` (live uniquement, c'est un moniteur). Dans `maybeImpulse` (Task 7) c'est déjà filtré `live` ; ajouter l'append du log juste après le dispatch dans `maybeImpulse` :

```js
      if (intent) document.dispatchEvent(new CustomEvent('meki:impulse', { detail: intent }));
      if (ev.type === 'hook_fired') appendHook(ev);
    }

    function appendHook(ev) {
      const d = ev.data || {};
      const tool = d.tool_name || (d.tool_input && d.tool_input.file_path) || '';
      const line = el('div', 'chat-hook-line');
      line.textContent = '▸ ' + ev.name + (tool ? ' · ' + tool : '');
      hooksLog.append(line);
      while (hooksLog.childElementCount > 100) hooksLog.removeChild(hooksLog.firstChild); // borne
      hooksLog.scrollTop = hooksLog.scrollHeight;
    }
```

- [ ] **Step 3 : CSS du volet** — dans `mekistudio/frontend/static/css/canvas.css`, ajouter :

```css
.chat-hooks { border-top: 1px solid #232c40; font-size: 11px; }
.chat-hooks-head { padding: 4px 10px; color: #8893a7; cursor: pointer; user-select: none; }
.chat-hooks-head::before { content: '▸ '; }
.chat-hooks.open .chat-hooks-head::before { content: '▾ '; }
.chat-hooks-log { display: none; max-height: 120px; overflow-y: auto; padding: 2px 10px 6px; font-family: ui-monospace, monospace; color: #7c8aa5; }
.chat-hooks.open .chat-hooks-log { display: block; }
.chat-hook-line { line-height: 1.6; white-space: nowrap; }
```

- [ ] **Step 4 : Vérifier la syntaxe**

Run: `node -c mekistudio/frontend/static/js/chat-view.js`
Expected: aucune sortie.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/chat-view.js mekistudio/frontend/static/css/canvas.css
git commit -m "feat(chat/front): volet hooks repliable (panneau debug F1)"
```

---

## Task 9 : ordre de chargement + validation Playwright

**Files:**
- Modify: `mekistudio/frontend/templates/canvas.html`
- Create: `scripts/pw-chat-impulses.mjs`

- [ ] **Step 1 : ordre de chargement** — dans `mekistudio/frontend/templates/canvas.html`, ajouter `chat-impulses.js` AVANT `canvas.js` (à côté de `cables.js`/`collision.js`). Trouver la ligne qui charge `canvas.js` et insérer juste avant :

```html
    <script src="{{ url_for('static', path='js/chat-impulses.js') }}"></script>
```

(Vérifier l'ordre final : `cables.js`, `collision.js`, `chat-impulses.js`, puis `canvas.js`.)

- [ ] **Step 2 : script Playwright**

Créer `scripts/pw-chat-impulses.mjs` :

```js
// Valide F1+F2 : un tour réel déclenche des impulsions (glow/comète) + remplit le volet hooks,
// et le reload ne rejoue PAS les impulsions (marqueur attached). Screenshots + console.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.pw');
mkdirSync(OUT, { recursive: true });
const logs = [];
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

// instrumente : compte les CustomEvent meki:impulse reçus
async function installCounter() {
  await p.evaluate(() => {
    window.__impulses = 0;
    document.addEventListener('meki:impulse', () => { window.__impulses++; });
  });
}

try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await installCounter();
  await p.waitForTimeout(1000);

  const ta = p.locator('.cmp-chat .chat-input').first();
  await ta.click();
  await ta.fill('Avec l\'outil Read, lis CLAUDE.md puis docs/ROADMAP.md. Puis réponds en un mot.');
  await ta.press('Enter');

  // attendre la fin de tour (statusbar cachée)
  await p.waitForFunction(
    () => { const sb = document.querySelector('.cmp-chat .chat-statusbar'); return !sb || sb.style.display === 'none'; },
    null, { timeout: 120000 },
  ).catch(() => logs.push('[wait] fin de tour timeout'));
  await p.waitForTimeout(1500);

  const liveImpulses = await p.evaluate(() => window.__impulses);
  const hookLines = await p.evaluate(() => document.querySelectorAll('.cmp-chat .chat-hook-line').length);
  await p.screenshot({ path: join(OUT, 'impulses-1-live.png') });

  // RELOAD : le replay ne doit PAS redéclencher d'impulsions
  await p.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForSelector('.cmp-chat .chat-input', { timeout: 15000 });
  await installCounter();
  await p.waitForTimeout(2500);
  const replayImpulses = await p.evaluate(() => window.__impulses);
  await p.screenshot({ path: join(OUT, 'impulses-2-reload.png') });

  console.log('LIVE impulses:', liveImpulses, '| hook lines:', hookLines);
  console.log('REPLAY impulses (doit être 0):', replayImpulses);
  const ok = liveImpulses >= 2 && replayImpulses === 0;
  console.log(ok ? '✅ PASS' : '❌ FAIL');
} catch (e) {
  logs.push(`[script-error] ${e.message}`);
} finally {
  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[wait'));
  console.log('CONSOLE_ERRORS:', errs.length);
  errs.forEach((x) => console.log('  ', x));
  await b.close();
}
```

- [ ] **Step 3 : Démarrer le serveur de test + lancer Playwright**

```bash
# serveur (code live) sur un port de test, en arrière-plan
uv run mekistudio serve --port 8799 --no-open
# (attendre "READY") puis :
node scripts/pw-chat-impulses.mjs
```
Expected: `LIVE impulses: >=2`, `hook lines: >0`, `REPLAY impulses: 0`, `✅ PASS`, `CONSOLE_ERRORS: 0`. **Regarder les screenshots** (`scripts/.pw/impulses-1-live.png`, `impulses-2-reload.png`) : un node a glowé / une comète est passée ; le volet hooks (déplié) liste des hooks. Arrêter le serveur ensuite.

- [ ] **Step 4 : Vérifier la suite complète**

```bash
uv run pytest -q
node --test mekistudio/frontend/static/js/chat-impulses.test.js mekistudio/frontend/static/js/chat-model.test.js mekistudio/frontend/static/js/cables.test.js mekistudio/frontend/static/js/collision.test.js
```
Expected: pytest tout vert ; node tout vert.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/templates/canvas.html scripts/pw-chat-impulses.mjs
git commit -m "feat(chat): ordre de chargement chat-impulses + validation Playwright F1+F2"
```

---

## Task 10 : MAJ docs (ROADMAP / ARCHITECTURE)

**Files:**
- Modify: `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1 : ROADMAP** — sous la brique chat, ajouter une puce :

```markdown
  - **Hooks → impulsions (F1+F2)** (livré) : les hooks Claude Code (capturés via hooks émetteurs
    `HookMatcher`) et la fin de tour déclenchent les impulsions existantes — comète chat→éditeur
    ouvert, glow explorateur (Glob/LS / fichier non ouvert), glow chat (fin de tour, clic=éteint),
    flash rouge (refus/erreur). Volet « hooks » repliable (debug). Events transients (`hook_fired`/
    `turn_end`/`attached`, non persistés). **Reste F3** : auto-spawn d'un éditeur sur lecture d'un
    fichier non ouvert (comète qui trace le câble + node éphémère, configurable).
```

- [ ] **Step 2 : ARCHITECTURE** — dans la section front, mentionner le nouveau module pur :

```markdown
- **`chat-impulses.js`** (`window.MekiImpulses`, pur, testé `node --test`) — mappe un event wire
  (`tool_result` enrichi, `turn_end`, `hook_fired`) vers une **intention** `{kind:'comet'|'glow',
  target, level}` ; `canvas.js` la résout (éditeur par `data-file`, explorateur/chat par `data-kind`)
  et déclenche `animateComet`/`glow`. Marqueur `attached` = fin de replay (impulsions live only).
```

- [ ] **Step 3 : Commit**

```bash
git add docs/ROADMAP.md docs/ARCHITECTURE.md
git commit -m "docs: hooks->impulsions F1+F2 livré (ROADMAP + ARCHITECTURE)"
```

---

## Notes / repli SDK

- **Si le smoke (Task 4) montre que l'émetteur PreToolUse ne tourne pas à côté du guard** (le SDK
  n'exécute qu'un hook par liste) : fusionner confinement + émission dans un seul hook PreToolUse,
  c.-à-d. faire en sorte que `make_repo_guard` appelle aussi `on_hook("PreToolUse", input_data)` avant
  de décider. Les autres hooks (PostToolUse, Stop, Notification) ne sont pas concernés (un seul hook).
- **Si un type de hook (Stop/Notification) n'émet jamais** en lecture seule : le panneau l'omet,
  et l'impulsion correspondante ne se déclenche pas (pas de régression — les impulsions critiques
  roulent sur `tool_result`/`turn_end` fiables). Documenter le réel dans le commit du smoke.
- **`data` des hooks shape-tolérant** : le front lit `data.tool_name` / `data.tool_input.file_path`
  avec repli sur '' — aucun crash si la forme diffère.

## Auto-review (fait)

- **Couverture spec** : F1.1 (Task 3), F1.2 (Task 1+2+3), F1.3 (Task 8), F1.4 (Task 4), F2.1 (Task 5),
  F2.2 (Task 6+7), F2.3 (Task 5+6+7), F2.4 (Task 6 `glowDismissable`), F2.5 (`_pulsing` réutilisé Task 6).
  Mapping §4 → Task 5. Anti-replay (non spécifié explicitement mais requis) → `attached` (Task 1/2/7).
- **Cohérence des noms** : `impulseFor`, `applyIntent`, `pulseTo`, `kindId`, `editorIdForFile`,
  `glowDismissable`, `make_hook_emitter`, `_emit_hook`, `hook_fired`/`turn_end`/`attached`, kinds DOM
  `chat`/`fileexplorer`/`fileeditor` — utilisés de façon cohérente entre tâches.
- **Placeholders** : aucun ; chaque step a du code complet et des commandes exactes.
```
