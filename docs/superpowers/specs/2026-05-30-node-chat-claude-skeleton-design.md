# Spec — Node chat × Claude Agent SDK (squelette vertical)

> Date : 2026-05-30 · Statut : design validé (brainstorming + compagnon visuel) → **durci par revue adversariale** → à transformer en plan.
> Origine : `docs/ROADMAP.md` (TODO « Node chat (ClaudeBridge) ») ; concepts de l'ancienne version : [`docs/old/mekistudio/04-claude-bridge.md`](../../old/mekistudio/04-claude-bridge.md) et [`docs/old/mekistudio/05-canvas.md`](../../old/mekistudio/05-canvas.md).
> **Durci par une revue adversariale** (5 relecteurs : SDK, async/concurrence, données/seq/reattach, intégration front, critique de complétude — 52 findings). Les corrections sont intégrées et signalées par 🛡️.
> Première tranche d'un découpage en 6 briques (B transport · A bridge · C node · D UI · E QCM · F hooks→impulsions). Cette spec = **squelette vertical** : un node chat qui pilote une vraie session Claude et streame du **texte**, bout-en-bout. Les briques D→F s'empilent ensuite **sans replomberie**.

## 1. Problème & vision

mekistudio affiche un canvas de nodes (`kernel`, `fileexplorer`, `fileeditor`) reliés par des câbles dérivés (`source_id`), avec impulsions livrées — mais **aucune intelligence** : zéro intégration LLM, zéro temps réel (pas de WebSocket).

On veut un **node chat** qui pilote une **vraie session Claude Code** (Claude Agent SDK Python) et streame ses réponses **mot par mot** dans des **bulles Discord-fidèles**. La session tourne **en tâche de fond façon `screen`/`tmux`** : fermer/recharger l'onglet **ne l'arrête pas** ; à la (re)connexion on **rejoue l'historique** puis on **suit le live**. Vision longue (`CLAUDE.md`) : importer mekistudio dans lui-même et le laisser s'améliorer.

## 2. Objectifs / non-objectifs

**Objectifs**
- **Un node chat intégré** (built-in, accroché au kernel) ; archi **multi-prête** : sessions/conversations **indexées par `conversation_id`**.
- **Chat texte pur, outils OFF** : Claude répond en texte, aucun outil.
- **Streaming token-par-token** : bulle qui se remplit en direct.
- **Session détachée « screen »** : bridge dans `app.state`, découplé du WS ; un tour survit à la déconnexion ; reattach = replay + live.
- **Persistance disque** : `meta.json` + `messages.jsonl` (records discrets) ; `resume=` au restart.
- **Contrôles** : **⏹ Stop** (interrupt), **⏳ file** de prompts, **✨ Nouvelle session** (clear).
- **UI Discord-fidèle, layout A** ; module front **pur et testable** (sans DOM).

**Non-objectifs (YAGNI — briques suivantes)**
- Pas de **tool-cards** (D), **hooks→impulsions** (F), **QCM/`ask_user`** (E), **permissions interactives**, **palette multi-node** (#2), **thinking blocks**, **panneau hooks**.
- **Pas de journalisation des deltas** (D4). 🛡️ Pas de **`title` de conversation** au skeleton (retiré, YAGNI — cf. F12).
- Backend : `backend/` n'importe **jamais** `frontend/`.

## 3. Décisions

| # | Décision | Choix retenu |
|---|----------|--------------|
| D1 | **Périmètre outils** | 🛡️ **`ClaudeAgentOptions(tools=[], permission_mode="dontAsk")`**. `tools=[]` **désactive tous les outils built-in** (Claude ne les voit pas) — c'est l'intention « outils OFF ». ⚠️ **Ne pas** utiliser `allowed_tools=[]` (simple allowlist : laisse les outils présents). `"dontAsk"` est une valeur `PermissionMode` confirmée (avec `tools=[]`, aucun prompt de permission ne peut survenir). **Plus d'incertitude.** |
| D2 | **Modèle de node** | **Un** node chat **built-in** (`default_canvas()` le sème, `source_id=kernel.id`). Archi **multi-prête** (tout indexé par `conversation_id`). 🛡️ Built-in ⇒ **non supprimable** (`422` via `_BUILTIN_KINDS`), donc aucune ré-attache d'enfants au skeleton (cf. spec câbles §7 pour le futur cas supprimable). |
| D3 | **Streaming** | `include_partial_messages=True`. Le SDK émet des `StreamEvent` ; on lit **défensivement** 🛡️ `event.get("type")=="content_block_delta"` & `event.get("delta",{}).get("type")=="text_delta"` → `.get("text","")` = fragment → wire `text_delta`. Les autres deltas (`input_json_delta`…) sont **ignorés**. |
| D4 | **Persistance** | **Records discrets** seq'd dans `messages.jsonl` : `user_message`, `assistant_message` (texte final), `session`, `error`. **Deltas JAMAIS journalisés.** `meta.json` = 🛡️ `{ id, created_at_ms, claude_session_id }` (**sans `title`**). **Rien d'autre que `conversation_id` dans `canvas.json`.** |
| D5 | **Session détachée** | `ChatBridge` par `conversation_id` dans `app.state`, **découplé du WS**. Une **boucle de consommation unique** (`asyncio.Task` possédée par le bridge) lit le flux SDK en continu → survit à la fermeture/au reload de l'onglet. |
| D6 | **Reattach « screen »** | À la connexion : `attach{since_seq}` → 🛡️ **section critique atomique** (sous le verrou d'état du bridge, §4.3) : (1) enfile les records `seq>since_seq` (lus AVANT le verrou) ; (2) si un tour est en vol, `message_start` + un `text_delta(in_flight.text)` **réutilisant `in_flight.message_id`** ; (3) inscrit la queue aux abonnés — **le tout sans `await` intercalé** → aucun delta live ne s'insère, pas de doublon, pas de 2ᵉ bulle. Le receiver **ne lit jamais** le store/`in_flight` lui-même. |
| D7 | **Transport** | **WebSocket** `/ws/chat/{conversation_id}`. Bidirectionnel (prêt QCM/permissions). Amorce la TODO #1. 🛡️ **Dépendance `websockets`** ajoutée à `pyproject` (uvicorn runtime l'exige ; `TestClient.websocket_connect` marche sans, via Starlette). |
| D8 | **Contrôles & mode streaming-input** | 🛡️ **BLOCKER corrigé** : `interrupt()` n'existe **qu'en mode streaming-input** (le client est alimenté par un **`AsyncIterable[dict]`**, pas une string). Le bridge pousse les prompts dans un **générateur persistant** (§4.3). **⏹ Stop** = `stop_requested=True` + `await client.interrupt()` ; le tour se finalise (status applicatif `interrupted` **déduit du flag**, pas du subtype SDK). **⏳ File** = `_pending: list[str]` **visible** (chips, annulable) ; un prompt n'est poussé au SDK qu'**après finalisation** du tour courant. **✨ Nouvelle session** = clear (D9/§4.x). |
| D9 | **Clear / nouvelle session** | 🛡️ **BLOCKER corrigé** : `manager.clear(old_id)->new_id` ne touche **que** les bridges/fichiers (interrupt + finalise/annule le tour, `disconnect()` le client, **retire** l'ancien bridge du registre). La **persistance du nouveau `conversation_id` sur le node** se fait **côté `frontend/routes/chat_ws.py`, sous `_canvas_lock` partagé** : `load_canvas` → balayer `iter_components` de chaque node → trouver le `ChatComponent` dont `conversation_id==old_id` → écrire `new_id` → `save_canvas`. (Respecte « backend n'importe jamais frontend » + évite le lost-update.) Le serveur **ferme/désabonne l'ancienne WS** après `cleared` (pas d'event tardif). Anciens fichiers conservés. |
| D10 | **Client SDK** | **Un `ClaudeSDKClient` par bridge, connecté en continu** en **streaming-input** via un générateur. **Injecté par factory** 🛡️ `create_app(repo_root, *, chat_client_factory=default_client_factory)` (défaut dans `backend/chat/bridge.py`) → bridge **et** router WS testables avec un faux client. **Une** boucle de consommation pour **tous** les tours ; bornes de tour = `ResultMessage`. |
| D11 | **Resume au restart** | Si `meta.json.claude_session_id` existe → `ClaudeAgentOptions(resume=session_id)` (contexte SDK). 🛡️ `session_id` capté dès le **`SystemMessage(subtype=="init")`** (fallback `ResultMessage.session_id`), persisté **une fois** ; `meta.json` est **autoritatif** pour le resume. `messages.jsonl` assure la continuité d'affichage. |
| D12 | **Front — 2 modules** | `chat-model.js` = **réducteur pur** (events → messages ; deltas, finalisation, file, **dédup par `seq`**), zéro DOM, `node --test`. `chat-view.js` = DOM impératif Discord-fidèle (layout A). 🛡️ **Cycle de vie de la WS** géré comme l'`EditorView` : registre `_chatViews[nodeId]` + handle `destroy()` (cf. D22). |
| D13 | **Markdown** | `marked` + `DOMPurify` **vendored** ; rendu **assaini au `message_stop`** ; en vol = texte brut. 🛡️ **Fallback** : si `window.DOMPurify` absent → afficher le **texte brut** (jamais de HTML non assaini). |
| D14 | **Épinglage SDK** | 🛡️ **Premier livrable = smoke test étendu** (§9) qui **fige l'API réelle** : streaming-input via générateur ; `SystemMessage(init)` + `session_id` ; séquence `message_start→content_block_delta(text_delta)*→message_stop` puis `AssistantMessage(content=[TextBlock])` puis `ResultMessage` ; **cas interrupt** (capture/fige le `subtype` réel, ex. `error_during_execution`) ; `tools=[]` ⇒ **aucun `ToolUseBlock`** ; **Windows** : binaire `claude` résolu + auth héritée, **sans prompt**. |
| D15 | **Composant & node** | `ChatComponent(type:"chat", conversation_id, title, placeholder)` ajouté à l'union `Component` ; 🛡️ **`model_rebuild()` sur `LayoutComponent`/`NodeComponent`** (les modèles qui *référencent* l'union), **pas** sur `ChatComponent`. `backend/nodes/chat.py` (`build_chat_node`, x=-440 — cf. F11). `registry.py` : `NODE_BUILDERS`, `CANONICAL_PARENT_KIND["chat"]="kernel"`, `default_canvas()`, `reconcile_*` (ne touchent jamais `node.root`, donc `conversation_id` **stable** — testé). |
| D16 | **Verrou d'état du bridge** | 🛡️ Un **`asyncio.Lock` par bridge** protège la section critique d'état : transitions `idle↔running`, mutation `_pending`, snapshot `in_flight`, décision **démarrer-vs-enfiler**, dépilage, mutation des abonnés, **et** `in_flight.text += delta` + enfilage du `text_delta`. **Distinct** du lock d'`append` du store ; jamais tenu pendant les `await` longs (lecture du flux SDK). Chaque tour porte un **`turn_id`** ; finalisation **idempotente** (drapeau `finalized`) ; `stop(turn_id)` n'`interrupt()` que si le tour ciblé est le **courant & RUNNING**. |
| D17 | **Broadcast** | 🛡️ Une **`asyncio.Queue` bornée par socket** ; le broadcast itère sur un **snapshot** `list(subscribers)` et fait **`put_nowait`** ; sur `QueueFull` → le socket est **désabonné/fermé** (il se reconnecte et `attach{since_seq}` pour rattraper) — **jamais** de blocage de la boucle de tour. Les `text_delta` étant transients (D4), leur perte sur un socket lent est rattrapée par le replay + `message_stop` durable. |
| D18 | **Shutdown propre** | 🛡️ **Lifespan FastAPI** dans `create_app` : crée le `ChatManager` (→ `app.state`) au démarrage ; au shutdown `await manager.shutdown()` = pour chaque bridge, annuler la tâche de tour (`cancel`+await en avalant `CancelledError`), `interrupt()` best-effort, `disconnect()` le client (pas de sous-process `claude` orphelin lors des `update --restart` fréquents). |

## 4. Architecture

### 4.1 Vue d'ensemble (flux d'une question)

```
① FRONT  node chat (chat-view.js)  ──prompt/stop/clear/cancel──▶  ┐
   composer + bulles Discord (chat-model.js : réducteur pur)        │ WebSocket
                                    ◀────── events (seq) ──────────  ┘ /ws/chat/{conversation_id}
③ BACK   ChatBridge (1/conversation_id, app.state, DÉTACHÉ du WS)
   client SDK streaming-input (générateur de prompts) + boucle de consommation unique ;
   tools=[], permission_mode="dontAsk", include_partial_messages ; verrou d'état (D16) ; broadcast borné (D17)
        │                                   │
④ SDK → claude CLI (sous-process)      ⑤ DISQUE .mekistudio/conversations/<id>/
   StreamEvent / AssistantMessage /        meta.json (claude_session_id, autoritatif)
   ResultMessage / SystemMessage(init)      messages.jsonl (records discrets seq'd)
```

**Invariant** : les messages ne vivent **pas** dans `canvas.json` ; le node n'y porte que `conversation_id`.

### 4.2 Packages backend (nouveaux) — `backend/chat/` (pur backend)

| Module | Rôle | Surface clé |
|--------|------|-------------|
| `events.py` | **Schéma du wire** + record persistant (Pydantic). 🛡️ Construit **en premier** (le store en dépend). | `StoredEvent{seq,type,ts,...}` ; `WireEvent` (union sur `type`). |
| `store.py` | Persistance d'une conversation ; **source de vérité du `seq`**. | `ConversationStore(root, conversation_id)` : `append(rec)->seq` (atomique, `asyncio.Lock`), `read_since(seq)`, `meta()`/`set_session_id()`, `next_seq`. 🛡️ Chargement **tolérant** : parse ligne par ligne, **ignore une dernière ligne tronquée**, `next_seq=max(seq)+1`. |
| `bridge.py` | **Moteur** détaché (streaming-input, machine d'états, verrou D16, broadcast D17). | `ChatBridge(conversation_id, store, client_factory)` : `start()`, `submit_prompt`, `stop`, `cancel_queued`, `attach(queue, since_seq)`, `unsubscribe`, `shutdown`, propriétés `state`/`in_flight{message_id,text}`/`pending`. `default_client_factory`. |
| `manager.py` | Registre des bridges par `conversation_id` (création paresseuse + resume) ; `clear` ; `shutdown`. | `ChatManager(repo_root, client_factory)` : `get_or_create`, `clear(old_id)->new_id`, `shutdown`. |

### 4.3 `ChatBridge` — streaming-input & machine d'états 🛡️

**Alimentation SDK (streaming-input, requis pour `interrupt()`)** : un générateur persistant draine une file interne `_to_sdk: asyncio.Queue[str]` :
```python
async def _message_stream(self):
    while True:
        text = await self._to_sdk.get()
        yield {"type": "user", "message": {"role": "user", "content": text}}
```
Le client est connecté **une fois** avec ce générateur (`client.query(self._message_stream())` / `connect`), et **une seule** tâche `_consume()` lit le flux pour **tous** les tours.

**État** (sous `_lock`, D16) : `state ∈ {idle, running, error}`, `_pending: list[str]`, `in_flight: {message_id, text}|None`, `turn_id`, `stop_requested`, `finalized`.

- **`submit_prompt(text)`** (depuis le receiver) — `async with _lock` :
  - `idle` → persiste `user_message` (seq) + broadcast → `state=running`, `turn_id=new_id()`, `stop_requested=False`, `finalized=False` → `_to_sdk.put_nowait(text)`.
  - `running` → `_pending.append(text)` → broadcast `queued`. *(Le `user_message` d'un prompt en file n'est persisté qu'au démarrage de son tour.)*
- **`_consume()`** (boucle unique) — `async for msg in client.receive_messages():`
  - `SystemMessage(init)` → si `session_id` non encore persisté : `store.set_session_id` (**meta d'abord**) puis append/broadcast `session`.
  - `StreamEvent` `message_start` → `async with _lock`: `in_flight={message_id:new_id(), text:""}` → broadcast `message_start`.
  - `StreamEvent` `content_block_delta`/`text_delta` → `async with _lock`: `in_flight.text += chunk` → broadcast `text_delta` *(non persisté)*.
  - `AssistantMessage` → `final_text = "".join(b.text for b in content if isinstance(b, TextBlock))` 🛡️.
  - `ResultMessage` → **finalisation** `async with _lock` (idempotente via `finalized`) : `status = "interrupted" if stop_requested else ("error" if subtype∈{error,error_*} else "success")` 🛡️ ; persiste `assistant_message{text: final_text or in_flight.text, status}` (seq) ; broadcast `message_stop{message_id, seq, status}` ; `in_flight=None` ; **enchaînement** : si `_pending` → dépile → re-démarre un tour (comme `submit_prompt` idle), sinon `state=idle`.
- **`stop()`** — `async with _lock`: si `running` → `stop_requested=True` → `await client.interrupt()`. 🛡️ Le **drain** est naturel : la boucle `_consume` unique lit le `ResultMessage(error_during_execution)` du tour interrompu **avant** qu'on ne pousse le prompt suivant (poussé seulement à la finalisation) → aucun reste mal attribué.
- **`cancel_queued(i)`** → retire `_pending[i]` + broadcast `queued`.
- **`attach(queue, since_seq)`** (D6) : `records = await store.read_since(since_seq)` **puis** `async with _lock`: enfiler `records` ; si `running and in_flight` → enfiler `message_start{in_flight.message_id}` + `text_delta{in_flight.message_id, in_flight.text}` ; **ajouter `queue` aux abonnés** — **sans `await` dans le bloc**.
- **`broadcast(ev)`** (D17) : `for q in list(self._subscribers): try q.put_nowait(ev) except QueueFull: self._drop(q)`.
- **`shutdown()`** : annuler `_consume` (avale `CancelledError`), `interrupt()` best-effort, `disconnect()`.

### 4.4 `ConversationStore` — persistance

`.mekistudio/conversations/<conversation_id>/` :
- **`meta.json`** 🛡️ `{ "id", "created_at_ms", "claude_session_id": str|null }` (écriture atomique tmp+rename). **Autoritatif** pour `resume`. 🛡️ Ordre de recouvrement : écrire `meta.json` **avant** d'append le record `session` à jsonl.
- **`messages.jsonl`** : append-only ; `seq` monotone (= n° de ligne) ; `append` sous `asyncio.Lock`.
  ```jsonl
  {"seq":1,"type":"user_message","ts":...,"text":"Bonjour"}
  {"seq":2,"type":"session","ts":...,"claude_session_id":"sess_abc"}
  {"seq":3,"type":"assistant_message","ts":...,"text":"Salut !","status":"success"}
  ```
- **`read_since(seq)`** : relit, renvoie `seq>seq`. 🛡️ Tolérant à une dernière ligne tronquée (ignore) ; `next_seq` reconstruit du dernier `seq` valide.

### 4.5 Node & composant

- **`ChatComponent`** : `type:Literal["chat"]`, `conversation_id:str=Field(default_factory=new_id)` (stable, persisté dans `canvas.json`), `title:str="chat"` (label UI), `placeholder:str="Écris à Claude…"`. Ajouté à l'union `Component` ; 🛡️ ré-`model_rebuild()` **Layout/Node** (D15).
- **`build_chat_node(x=-440.0, y=0.0)`** → `Node(kind="chat", x, y, w=400, h=520, movable=True, resizable=True, root=NodeComponent([LayoutComponent([ChatComponent()])]))`. 🛡️ x=-440 (w=400 → bord droit à -40) pour **ne pas chevaucher** le kernel (0,0) ; tout résidu serait de toute façon résorbé au boot par `reconcileOverlaps` (node déplaçable).
- **`registry.py`** : `NODE_BUILDERS["chat"]`, `CANONICAL_PARENT_KIND["chat"]="kernel"`, `default_canvas()` (chat `source_id=k.id`). 🛡️ `reconcile_constraints`/`reconcile_source_links` itèrent sur `state.nodes` **sans descendre dans `node.root`** → `conversation_id` jamais touché (testé §9). Le `new_id()` du template `build_chat_node()` appelé par `reconcile_constraints` est volontairement jeté.

### 4.6 Transport WS — protocole `/ws/chat/{conversation_id}`

**Client → serveur** : `attach{since_seq}` (1er message) · `prompt{text}` · `stop` · `cancel_queued{index}` · `clear`.

**Serveur → client** :
| `type` | Champs | Durable (`seq`) ? |
|--------|--------|-------------------|
| `user_message` | `seq, ts, text` | ✅ |
| `message_start` | `message_id` | ❌ transient |
| `text_delta` | `message_id, text` | ❌ transient (jamais persisté) |
| `message_stop` | `message_id, seq, status` | ✅ (réfère le `assistant_message`, même `seq`) |
| 🛡️ `assistant_message` | `seq, ts, text, status` | ✅ **(chemin REPLAY)** |
| `session` | `seq, claude_session_id` | ✅ |
| `error` | `seq, message` | ✅ |
| `queued` | `items:[{index,text}]` | ❌ (état recalculable) |
| `cleared` | `conversation_id` | ❌ |

🛡️ **Deux chemins, un même `seq`** : en **live**, une bulle assistant naît de `message_start`→`text_delta*`→`message_stop{seq=K}` ; au **replay**, le record durable `assistant_message{seq=K}` crée **directement** la bulle finale. Le réducteur **dédup par `seq`** → reattach après fin de tour = **bulle unique**. Le bridge n'émet `message_start+in_flight` que si le tour est **RUNNING et non finalisé** ; `read_since` ne renvoie jamais à la fois l'`assistant_message` finalisé **et** un in-flight pour le même tour.

### 4.7 Router WS & broadcast — `frontend/routes/chat_ws.py`

- `@router.websocket("/ws/chat/{conversation_id}")` → `accept()` → `bridge = manager.get_or_create(conversation_id)`.
- Une **`asyncio.Queue(maxsize=…)`** par connexion (D17).
- `receiver` (lit `attach`/`prompt`/`stop`/`cancel_queued`/`clear`) + `sender` (`await ws.send_json(await queue.get())`). 🛡️ **`try/finally` : `bridge.unsubscribe(queue)` inconditionnel** ; dès qu'une coroutine se termine, l'autre est **annulée et attendue** (`wait(FIRST_COMPLETED)` + cancel). **Ne jamais détruire le bridge ici** (D5).
- `attach` → `await bridge.attach(queue, since_seq)` (la section critique vit dans le bridge, D6).
- **`clear`** 🛡️ → `new_id = await manager.clear(conversation_id)` (rotation bridges/fichiers) → **rotation du node sous `_canvas_lock` partagé** (D9) → `send_json(cleared{new_id})` → **fermer la WS** côté serveur (le client reconnecte sur `new_id`).
- **`app.py`** : 🛡️ `create_app(repo_root=None, *, chat_client_factory=None)` instancie `ChatManager(repo_root, chat_client_factory or default_client_factory)` dans un **lifespan** (D18), `app.state.chat_manager`, et **partage `_canvas_lock`** via `app.state` (centralise toutes les écritures `canvas.json` derrière un lock unique). `include_router(chat_ws.router)`.

### 4.8 Front — `chat-model.js` (pur) & `chat-view.js` (DOM)

**`chat-model.js`** (`window.MekiChat` + `module.exports`) — **pur** :
- `createState()` → `{messages:[], inFlight:null, lastSeq:0, queue:[], state:'idle'}`.
- `reduce(state, event)` :
  - `message_start` → 🛡️ **réinitialise** `inFlight={message_id, text:''}` (idempotent, pas d'append).
  - `text_delta` → **append** à `inFlight.text` (status `streaming`).
  - `message_stop` → fige la bulle (`final`/`interrupted`/`error`), `lastSeq=seq`.
  - 🛡️ `assistant_message` (replay) → crée **directement** une bulle finale `{seq, text, status}` ; `lastSeq=seq`. **Dédup par `seq`** avec le chemin live.
  - `user_message`/`session`/`error` → `lastSeq=seq` ; `queued` → `queue`.

**`chat-view.js`** (DOM impératif, layout A) :
- Monté par la branche `renderComponent(c, node)` pour `type:"chat"`, avec 🛡️ `conversation_id = c.conversation_id` (**jamais `node.id`**).
- 🛡️ **Cycle de vie (registre `_chatViews[node.id]`, handle `{destroy()}`)** comme l'`EditorView` : `destroy()` pose `intentionalClose=true`, ferme la WS, **annule le timer de backoff**. Appelé dans `rerenderNode` (**avant** `replaceChildren`), au retrait du wrap, et pour les handles existants **avant** le `renderNodes()` global du boot → **zéro fuite de socket/timer**.
- 🛡️ **WebSocket** : à l'ouverture `attach{since_seq:lastSeq}` ; **reconnexion backoff borné** (0,5 s→8 s + jitter) **seulement** si fermeture non intentionnelle ; un **`generation`** incrémenté à chaque (re)connexion/clear, capturé dans la closure → tout event d'une génération périmée est **ignoré**.
- 🛡️ **Clear** : à réception de `cleared{conversation_id}` → fermer la WS (`intentionalClose`), mettre à jour `conversation_id` interne **et** la valeur du composant, `MekiChat.createState()` (vide, `lastSeq=0`), ouvrir une nouvelle WS `attach{since_seq:0}`. **Pas** via `rerenderNode` (éviter la fuite).
- 🛡️ **Interactions dans une node-wrap déplaçable** : `wheel` + `mousedown` **`stopPropagation`** sur la liste scrollable, le textarea, les boutons (Stop/✨/chips ✕) et les liens markdown (comme `.cmp-editor`/`.editor-bar`). **Layout flex colonne** : header fixe · liste `flex:1; overflow:auto` · barre d'état + chips + composer en pied (survit au resize).
- **Markdown** (D13) : au `message_stop`/`assistant_message`, `DOMPurify.sanitize(marked.parse(text))` ; fallback texte si `DOMPurify` absent.
- 🛡️ **Ordre des scripts** (template, tous `<script defer>`, AVANT le `defer` d'Alpine) : `cables.js`, `collision.js`, `marked.min.js`, `purify.min.js`, `chat-model.js`, `chat-view.js`, `canvas.js` → **puis** Alpine (`defer`) → **puis** `editor.js` (module). Globals attendus : `window.marked`, `window.DOMPurify` (UMD — à vérifier au vendoring), `window.MekiChat`.

## 5. Comportements détaillés

- **Détachement (screen)** : prompt → fermer l'onglet → la boucle persiste `assistant_message` à la fin. Rouvrir → `attach{since_seq:0}` rejoue (record durable). Rouvrir **pendant** le tour → replay records + `message_start`+`text_delta(in_flight)` (même `message_id`) + suite live (atomique, D6).
- **Stop** : ⏹ → `stop_requested` + `interrupt()` → `assistant_message status:"interrupted"` (partiel). Bulle figée « interrompu ».
- **File** : pendant un tour, envoyer → chip ; à la fin, premier de la file démarre (son `user_message` est alors persisté). `✕` → `cancel_queued`.
- **Nouvelle session** : ✨ → `clear` → nouvelle `conversation_id` persistée (sous `_canvas_lock`) → ancienne WS fermée serveur → client reconnecte sur la nouvelle id (affichage vide). Anciens fichiers conservés.
- **Restart serveur** : au prochain `attach`, bridge (re)créé ; `meta.json`→`resume` ; `read_since(0)` rejoue l'affichage.
- 🛡️ **Erreur de connexion SDK** (CLI absente / non authentifiée) : `get_or_create` **n'échoue pas** — le bridge se crée en **connexion paresseuse** (connect au 1er `submit_prompt`) ou capture l'exception → état `error` qui, sur `attach`/`prompt`, **broadcast un event `error` persistable** (bulle + invite à réessayer).

## 6. Persistance & invariants préservés

- `canvas.json` : le node chat n'y porte que `conversation_id` (+ géométrie). **Aucun message.**
- 🛡️ Toutes les écritures `canvas.json` (move/resize/spawn/settings **et** rotation `conversation_id` du clear) passent par le **même `_canvas_lock`** (partagé via `app.state`).
- `default_canvas()`/`_ensure_builtin_nodes`/`reconcile_*` couvrent le chat comme built-in ; `conversation_id` **stable** (réconciliation n'inspecte que les contraintes de `Node`, jamais `node.root`) — **testé** (§9).
- Écritures disque **atomiques** ; I/O **sandboxée** sous la racine repo.
- `backend/` n'importe jamais `frontend/` : `backend/chat/` autonome ; câblage WS + rotation canvas dans `frontend/routes/` + lifespan dans `app.py`.

## 7. SDK — surface utilisée & épinglage (D14)

🛡️ **Mode streaming-input** (générateur de messages dicts), confirmé par la doc comme **seul** mode supportant `interrupt()` :
```python
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
from claude_agent_sdk.types import TextBlock  # filtrage du texte final
opts = ClaudeAgentOptions(
    cwd=str(repo_root),
    tools=[],                       # 🛡️ outils OFF (built-in désactivés) — PAS allowed_tools=[]
    permission_mode="dontAsk",      # 🛡️ valeur confirmée
    include_partial_messages=True,  # streaming token-par-token
    resume=session_id,              # None au 1er lancement (D11)
)
client = ClaudeSDKClient(options=opts)
await client.query(message_stream())            # AsyncIterable[dict] (streaming-input)
async for msg in client.receive_messages():     # boucle UNIQUE, tous les tours
    # StreamEvent(event={"type":"content_block_delta","delta":{"type":"text_delta","text":...}})  -> .get() défensif
    # AssistantMessage(content=[TextBlock(text=...), ...])  -> filtrer isinstance(b, TextBlock)
    # ResultMessage(session_id=..., subtype="success"|"error"|"error_during_execution"|...)
    # SystemMessage(subtype="init", data={... session_id ...})  -> capter session_id tôt
    ...
await client.interrupt()   # 🛡️ requiert le mode streaming-input ; subtype de fin = error_during_execution
await client.disconnect()  # clear / shutdown
```
**Figé par le smoke test (D14)** : mécanisme outils-OFF (`tools=[]` ⇒ aucun `ToolUseBlock`) ; `permission_mode` ; forme des `StreamEvent`/`delta` ; `session_id` (init + ResultMessage) ; **subtype réel après `interrupt()`** ; **Windows** (sous-process `claude` résolu, auth héritée, boucle asyncio supportant les subprocess — *Proactor* requis sur win32 ; vérifier sous uvicorn).

## 8. Cas limites & risques

- 🛡️ **`interrupt()` & drain** : boucle de consommation **unique** → le `ResultMessage(error_during_execution)` du tour interrompu est lu avant tout nouveau prompt (poussé seulement à la finalisation). Pas de reste mal attribué. Finalisation **idempotente** (drapeau + `turn_id`).
- 🛡️ **Reattach atomique** (D6) : snapshot `in_flight` + abonnement **sans `await` intercalé**, sous `_lock` → ni doublon ni trou ; `message_start` de rattrapage **réutilise `in_flight.message_id`** → pas de 2ᵉ bulle. Pour les sockets **déjà** abonnées, pas de rattrapage (deltas incrémentaux normaux).
- 🛡️ **Backpressure** (D17) : socket lent → `QueueFull` → désabonné/fermé → se reconnecte et rattrape par replay. La boucle de tour n'est **jamais** bloquée.
- 🛡️ **Itération abonnés** : toujours sur `list(subscribers)` ; sub/unsub sous `_lock`.
- 🛡️ **Clear pendant un tour** : `manager.clear` interrompt + **attend la finalisation/annule**, `disconnect`, **retire** le bridge ; le serveur **ferme l'ancienne WS** après `cleared` → aucun event tardif. Côté client, `generation` ignore tout reste.
- 🛡️ **Shutdown serveur** (`update --restart` fréquent) : lifespan `manager.shutdown()` → tâches annulées, clients déconnectés, pas de sous-process orphelin ni de jsonl tronqué en plein append.
- 🛡️ **jsonl tronqué** (crash en plein append) : chargement tolérant (ignore la dernière ligne non parsable), `next_seq` correct.
- 🛡️ **meta vs jsonl** : `meta.json` écrit avant le record `session` ; `meta` autoritatif pour `resume`.
- 🛡️ **Erreur de connexion SDK** : bridge dégradé/lazy → event `error`, jamais de plantage du router à l'`accept`.
- **Windows / dev loop** : pas de hot-reload → restart + hard refresh ; `canvas.json` périmé → node invisible (régénérer).
- **Markdown** : `DOMPurify` obligatoire (vendored, offline) ; fallback texte si absent.
- **Câble `chat↔kernel`** : `cableClass` → **fallback neutre** (spec câbles D6).

## 9. Stratégie de test (TDD)

**Smoke SDK (en premier, D14, étendu)** — `tests/integration/test_sdk_smoke.py`, `@pytest.mark.integration` (🛡️ marker enregistré dans `pyproject`, dossier `tests/integration/__init__.py` créé ; skip par défaut `-m "not integration"`) : streaming-input via générateur ; assert `SystemMessage(init)`+`session_id` ; séquence `message_start→text_delta*→message_stop`+`AssistantMessage(TextBlock)`+`ResultMessage` ; **cas interrupt** (capture le `subtype` réel, `xfail`/record si ≠ attendu) ; `tools=[]` ⇒ aucun `ToolUseBlock` ; **Windows** : `claude` résolu + 1 réponse sans prompt d'auth.

**Backend (pytest, faux `client_factory` scripté)** :
- `events.py`/`ConversationStore` : `append`→`seq` monotone ; `read_since` ; `meta`/`set_session_id` ; atomicité ; relecture après « restart » (`next_seq` correct) ; 🛡️ **jsonl à dernière ligne tronquée** → charge quand même.
- `ChatBridge` (streaming-input simulé) : prompt → `user_message`/`message_start`/`text_delta*`/`message_stop` ordonnés ; accumulation = texte final (filtré `TextBlock`) ; `session` persisté une fois (meta d'abord) ; **file** (prompt pendant RUNNING → `queued` → exécuté ensuite, `user_message` au démarrage) ; **stop** (`interrupt` → `assistant_message status:"interrupted"`, **status déduit du flag**) ; 🛡️ **drain** (prompt long → stop → le prompt suivant ne reçoit que SES events) ; `cancel_queued` ; **finalisation idempotente** (pas de double) ; 🛡️ **verrou d'état** (deux `submit_prompt` concurrents ne lancent qu'un tour).
- 🛡️ **Reattach** : 2ᵉ queue abonnée en cours de tour → `message_start`+`text_delta(in_flight)` (**même `message_id`**) puis live, **sans doublon** ; **double attach pendant tour** (reset OK) ; abonnement après fin → replay `assistant_message` (bulle unique, dédup `seq`) ; 🛡️ **reattach pile à la finalisation** (race message_stop vs déconnexion).
- **Manager** : `get_or_create` idempotent ; `resume` quand `meta` a un `session_id` ; **`clear`** → nouvelle id + ancien dossier conservé ; 🛡️ **`shutdown`** annule une tâche en vol + `disconnect`.
- 🛡️ **Connexion SDK qui lève** (`client_factory` ko au connect) → pas de plantage, event `error`.
- **Composant/node/registry** : `ChatComponent` roundtrip ; `build_chat_node` ; `default_canvas()` (chat `source_id=kernel.id`) ; 🛡️ **`conversation_id` survit à `load→reconcile→save`**.
- **Router WS** (`TestClient.websocket_connect`, 🛡️ `create_app(tmp_root, chat_client_factory=fake)`) : `attach`→replay ; `prompt`→events ; `stop`/`clear` (rotation sous `_canvas_lock`, ancienne WS fermée) ; déconnexion **n'arrête pas** le bridge (reconnexion → suite) ; 🛡️ `unsubscribe` garanti en `finally`.

**Front pur (`node --test`)** — `chat-model.test.js` : `reduce` par event ; assemblage deltas ; 🛡️ `message_start` **reset** (double attach idempotent) ; finalisation (final/interrupted/error) ; 🛡️ **chemin replay `assistant_message`** + **dédup `seq`** (replay+live = bulle unique) ; file ; `lastSeq`.

**Comportement (Playwright, screenshot + console)** — *checkpoint* :
- Prompt → bulle qui se remplit → `message_stop` → markdown ; **0 erreur console**.
- 🛡️ **Reload pendant un tour** → persiste **et** continue (reattach) ; 🛡️ **fermeture/reload ne laisse pas de socket fuyante** (console : pas de reconnexion vers un DOM détaché).
- ⏹ Stop → bulle « interrompu » ; ⏳ file (envoi pendant tour → chip → exécuté ; `✕` annule) ; ✨ nouvelle session (vidé, ancien dossier sur disque).
- 🛡️ Scroll de l'historique **ne zoome pas** le canvas ; clic dans le composer **ne déplace pas** le node.
> Rappel mémoire projet : valider le front avec **Playwright (screenshot + console)** ; restart `serve` + hard refresh (pas de hot-reload).

## 10. Fichiers touchés

**Créés** : `backend/chat/{__init__,events,store,bridge,manager}.py` · `backend/nodes/chat.py` · `frontend/routes/chat_ws.py` · `frontend/static/js/{chat-model.js,chat-model.test.js,chat-view.js}` · `frontend/static/vendor/{marked.min.js,purify.min.js}` · `tests/integration/{__init__.py,test_sdk_smoke.py}` · `tests/unit/test_chat_*.py`.

**Modifiés** : `backend/components/primitives.py` (+`ChatComponent`, union, 🛡️ rebuild Layout/Node) + `backend/components/__init__.py` · `backend/nodes/registry.py` + `backend/nodes/__init__.py` · `frontend/app.py` (🛡️ `create_app(*, chat_client_factory)` + **lifespan** + `ChatManager` + `_canvas_lock` partagé + router WS) · `frontend/routes/canvas.py` (🛡️ `_canvas_lock` exposé via `app.state`) · `frontend/static/js/canvas.js` (branche `renderComponent` `type:"chat"` + registre `_chatViews`/`destroy` dans `rerenderNode`/retrait/boot) · `frontend/static/css/canvas.css` · `frontend/templates/canvas.html` (🛡️ ordre des scripts) · `pyproject.toml` (`claude-agent-sdk`, 🛡️ `websockets`, 🛡️ marker `integration`) · `docs/ROADMAP.md`.

## 11. Découpage en phases (entrée du plan)

**Phase 0 — Épinglage SDK** : `pyproject` (`claude-agent-sdk`, `websockets`, marker) + **smoke test étendu** (D14). → fige l'API (streaming-input, interrupt, subtype, tools=[], Windows).

**Phase 1 — Moteur backend (headless, TDD)** : 🛡️ **`events.py` → `store.py`** → `bridge.py` (faux client streaming-input) → `manager.py`. Tests : store (+ jsonl tronqué), bridge (file, stop, drain, verrou, finalisation idempotente), reattach (atomicité, in_flight_message_id, dédup), manager (clear, shutdown, resume, connexion ko). **Aucune UI.**

**Phase 2 — Node & transport** : `ChatComponent` + `chat.py` + `registry`/`default_canvas` (+ test stabilité `conversation_id`) ; `chat_ws.py` + `app.py` (lifespan, `_canvas_lock` partagé, injection `chat_client_factory`) + test WS.

**Phase 3 — Front** : `chat-model.js` + `chat-model.test.js` (`node --test`, chemins live+replay) ; `chat-view.js` (registre `_chatViews`/`destroy`, generation, backoff, stopPropagation, markdown) + CSS layout A ; branche `renderComponent` ; ordre des scripts + vendoring.

**Phase 4 — Validation navigateur (Playwright)** : stream, reload-pendant-tour, **pas de fuite WS**, stop, file, nouvelle session, scroll/clic sans déplacer le node, captures + console propre. **Checkpoint.**

Chaque étape : test (rouge) → implémentation (vert) → commit.

## 12. Hors périmètre / extensions futures (briques suivantes)

- **Brique D — Tool-cards** : réactiver des outils + rendre `tool_use`/`tool_result` (icône+teinte, `TOOL_META`). L'enveloppe accueille `tool_use_*` (et `input_json_delta`, déjà ignoré, D3).
- **Brique F — Hooks → impulsions** : `ClaudeAgentOptions(hooks=…)`/`include_hook_events` → events `hook` → comète/glow + panneau hooks.
- **Brique E — QCM / `ask_user`** : `can_use_tool` interceptant `AskUserQuestion` → event `ask_user` → formulaire-bulle (single/multi/texte) → réponse réinjectée (WS bidirectionnel déjà là). *(Note : `dontAsk` refusera tout outil tant qu'il n'est pas rouvert.)*
- **Permissions interactives**, **palette multi-node**, **thinking blocks**, **historique de conversations** (où `title` de conversation reviendra, F12).
