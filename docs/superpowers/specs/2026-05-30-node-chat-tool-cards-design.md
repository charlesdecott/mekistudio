# Spec — Tool-cards lecture seule (brique D du node chat)

> Date : 2026-05-30 · Statut : design validé (brainstorming + compagnon visuel) → **durci par revue adversariale** → plan.
> Étend le **node chat** (squelette livré : [`2026-05-30-node-chat-claude-skeleton-design.md`](2026-05-30-node-chat-claude-skeleton-design.md)). Réfs : [`docs/tool-card-styles.md`](../../tool-card-styles.md) (modes de rendu + `TOOL_META`), [`docs/sandbox-isolation-research.md`](../../sandbox-isolation-research.md) (isolation = brique Docker séparée).
> **Durci par revue adversariale** (5 lentilles + vérification : 11 findings confirmés, 2 incertains). Corrections marquées 🛡️.
> Découpage : A bridge · B transport · C node · D **tool-cards (cette spec)** · E QCM · F hooks→impulsions. Isolation Docker (write/Bash) = **brique à part** (roadmap #7).

## 1. Problème & vision

Le node chat parle mais **n'agit pas** (`tools=[]`). On rallume des outils **lecture seule** (Read/Glob/Grep/LS), **confinés au repo**, et on affiche chaque appel comme une **carte** (icône + couleur, état ⟳/✓/✗/🚫) dans la bulle « Claude ». Première fois que Claude *fait* quelque chose dans le studio — sans risque (lecture seule), en exerçant toute la chaîne tool-cards. Write/Edit/Bash + isolation = brique Docker ensuite.

## 2. Objectifs / non-objectifs

**Objectifs** — outils **lecture seule** ; **confinement repo fiable** (toute tentative hors-repo = refus → carte 🚫) ; **tool-cards mode C** (log terminal) ; **tours multi-étapes** corrects ; persistance des appels (replay) ; API tool **épinglée par smoke**.

**Non-objectifs (briques suivantes)** — pas de Write/Edit/Bash ni d'isolation (brique Docker ; sur Windows natif pas de sandbox OS, la lecture seule est sûre sans conteneur) ; pas de modes A/B (réglages futurs) ; pas de QCM/hooks→impulsions ; pas de streaming des args partiels (`input_json_delta`) — l'input vient du `ToolUseBlock`.

## 3. Décisions

| # | Décision | Choix retenu |
|---|----------|--------------|
| D1 | **Jeu d'outils** | `ClaudeAgentOptions(tools=["Read","Glob","Grep","LS"])` → **seuls** ces outils existent (lecture seule garantie au niveau SDK). |
| D2 | **Confinement** 🛡️ | **Hook `PreToolUse`** (PAS `can_use_tool`) : le hook voit **tous** les appels et tourne **avant** les règles de permission, donc il n'est jamais court-circuité par l'auto-allow des outils lecture. Combo : `tools=[…]` (D1) + `allowed_tools=["Read","Glob","Grep","LS"]` (auto-approuve l'**in-repo** → zéro popup) + `permission_mode="default"` + `hooks={"PreToolUse":[HookMatcher(matcher=None, hooks=[guard])]}` + **`cwd=str(repo_root)` (obligatoire** — borne les patterns relatifs ; le squelette ne le fixait pas, on le **corrige**). Le guard **deny** hors-repo (message renvoyé à Claude → carte 🚫), sinon laisse passer. `repo_root` threadé : `ChatManager(repo_root)` → `ChatBridge` → `build_options`/guard. *(Cohabite plus tard avec le hook impulsions de la brique F : liste de hooks.)* |
| D3 | **Tour multi-étapes** ⚠️🛡️ | Un tour = N **étapes** (chaque `AssistantMessage` = une étape : texte + 0..n `ToolUseBlock`), entrecoupées de `tool_result`, jusqu'au `ResultMessage` SDK. On **finalise chaque étape sur son `AssistantMessage`** (drapeau `step_finalized`, reset à chaque `message_start`) ; le **texte vient de l'event `AssistantMessage`** (on supprime le `_final_text` per-tour du squelette). Le `ResultMessage` SDK = **fin de tour** (`turn_finalized`) : capture session, finalise une étape en vol restante (interrupt), **balaye les outils orphelins** (D8), dépile/idle. Tour texte-seul (1 `AssistantMessage`) = comportement **identique au squelette**. |
| D4 | **Normalisation tool** 🛡️ | Adaptateur `options.py` : `AssistantMessage` → `{"kind":"assistant", text, tools:[{id,name,input}…]}` (tools = ses `ToolUseBlock`, `input` = dict) ; `UserMessage` avec `ToolResultBlock` → un `{"kind":"tool_result", id, output, is_error}` par bloc, où **`output = _tool_output(block.content)`** (coercion : `content` peut être `str` \| `list[dict]` \| `None` → toujours `str`, **tronqué** à une borne). Appariement par `tool_use_id`. |
| D5 | **Wire (ajouts, durables)** | `tool_use{seq,id,name,input,ts}` · `tool_result{seq,id,output,is_error,ts}`. 🛡️ Un `tool_result` peut être **synthétique** (orphelin clos, D8). Les `assistant_message`/`message_start`/`text_delta`/`message_stop` existent — désormais **un jeu par étape**. |
| D6 | **Front — mode C** | `chat-model.js` : `state.toolsById` ; `tool_use` crée la carte (`running`) **rattachée à la dernière bulle assistant** (l'étape courante, via une liste `tools[]` d'ids sur le message) ; `tool_result` → `status = is_error ? 'error' : 'done'`, `output`. Dédup par `seq`. `chat-view.js` : bloc « console » mono sous le texte de l'étape, rendu via **`TOOL_META`** (icône+couleur), **arg clé** par outil (`fileArg`), sortie **dépliable**. |
| D7 | **Persistance** | `tool_use` + `tool_result` (réels **et** synthétiques) = **records durables** `messages.jsonl`. Replay reconstitue les cartes (dédup par `seq`). Rien de plus dans `canvas.json`. |
| D8 | **Outils orphelins / « bloqué »** 🛡️ | **BLOCKER corrigé.** À la fin de tour (sous le verrou), tout `tool_use` du tour **sans `tool_result` apparié** → on **persiste + broadcast un `tool_result{id, is_error:true, output:"interrompu"}` synthétique** → la carte se ferme (✗/🚫) en live **et** au reattach. Ça couvre 2 cas : (a) interrupt en plein outil ; (b) **un guard-deny qui ne produit PAS de `ToolResultBlock`** (forme dépendante du CLI). Le guard connaît l'`id` via `context.tool_use_id` si besoin. La forme réelle d'un deny est **capturée** par le smoke (D9), pas supposée. |
| D9 | **Épinglage SDK (smoke isolé)** 🛡️ | Smoke (lecture seule = **sûr**) dans un **repo temporaire neuf** + `setting_sources=[]` (aucune allow/deny-rule de l'utilisateur/repo ne charge) : (a) fige la séquence multi-étapes (`message_start`/`text_delta`/`message_stop` puis `AssistantMessage`) ; (b) `AssistantMessage.content` = `TextBlock`+`ToolUseBlock(id,name,input)` ; (c) `ToolResultBlock(tool_use_id, content, is_error)` via `UserMessage`, **content `str` OU `list[dict]`** (assert `_tool_output` non vide) ; (d) **prouve que le guard tourne** (compteur d'appels du hook ≥1 sur l'appel hors-repo) ET qu'il **deny** ; (e) **capture** (print/xfail) la forme réelle d'un deny ; (f) cas **interrupt en plein outil** (capture si un `ToolResultBlock` arrive ou non). |
| D10 | **`TOOL_META`** 🛡️ | Aligné sur `tool-card-styles.md` : Read 📄 bleu `#4d8dff` · Glob 🔍 / Grep 🔎 violet `#b388ff` · LS 📁 gris `#8893a7` · (bloqué) 🚫 rouge `#e5484d`. `fileArg` par outil : Read→`file_path`, LS→`path`, Glob→`pattern`, Grep→`pattern`. Extensible (Edit/Write/Bash → brique Docker). |

## 4. Architecture

### 4.1 Confinement — guard `PreToolUse` durci (backend) 🛡️

`backend/chat/guard.py` — **default-deny par outil, ne lève jamais** (tout doute = deny) :
```python
READ_TOOLS = {"Read": "file_path", "LS": "path", "Glob": "path", "Grep": "path"}
EXTRA_PATH = {"Glob": ["pattern"], "Grep": ["glob"]}   # champs additionnels pouvant porter un chemin
PATH_OPTIONAL = {"Glob", "Grep"}                       # path absent -> défaut = cwd = repo (sûr car cwd fixé)

def _inside(root: Path, candidate) -> bool:
    if not isinstance(candidate, str) or candidate == "":
        return False
    try:
        (root / candidate).resolve().relative_to(root)   # gère relatif (root==cwd), absolu, .., symlink (resolve suit)
        return True
    except (ValueError, TypeError, OSError):
        return False

def make_repo_guard(repo_root: Path):
    root = repo_root.resolve()
    async def pre_tool_use(input_data, tool_use_id, context):
        name = input_data.get("tool_name")
        tool_input = input_data.get("tool_input", {}) or {}
        if name not in READ_TOOLS:
            return _deny(f"Outil « {name} » non autorisé (lecture seule).")
        key = READ_TOOLS[name]
        primary = tool_input.get(key)
        if primary in (None, "") and name not in PATH_OPTIONAL:
            return _deny("Chemin manquant.")
        for field in ([key] if primary not in (None, "") else []) + EXTRA_PATH.get(name, []):
            val = tool_input.get(field)
            if val in (None, ""):
                continue
            if not _inside(root, val):           # absolu hors-repo, .. sortant, type invalide -> deny
                return _deny(f"« {val} » ({field}) est hors du dossier du projet.")
        return {}                                # {} = laisse les règles de permission auto-approuver l'in-repo

    def _deny(msg):
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                       "permissionDecision": "deny", "permissionDecisionReason": msg}}
    return pre_tool_use
```
> 🛡️ **Pourquoi un hook et pas `can_use_tool`** : en `permission_mode="default"`, `can_use_tool` n'est PAS appelé pour un outil auto-approuvé → confinement contourné. Le hook `PreToolUse` voit **tous** les appels et s'exécute **avant** les règles de permission (un `deny` gagne sur l'auto-allow). `allowed_tools` auto-approuve l'in-repo (zéro popup), le hook bloque l'hors-repo. *(Noms exacts du dict de sortie figés par le smoke.)*

`options.py` `build_options(repo_root, store)` : `tools=["Read","Glob","Grep","LS"]`, `allowed_tools=["Read","Glob","Grep","LS"]`, `permission_mode="default"`, `hooks={"PreToolUse":[HookMatcher(matcher=None, hooks=[make_repo_guard(repo_root)])]}`, **`cwd=str(repo_root)`**, `include_partial_messages=True`, `resume=…`, `setting_sources=[]` *(à confirmer : isole des settings utilisateur)*.

### 4.2 Bridge — `_consume` multi-étapes (D3) 🛡️

État ajouté : `step_finalized: bool`, `turn_finalized: bool`, `_turn_tool_ids: set`, `_turn_tool_results: set`. Reset dans `_start_turn` (`turn_finalized=False`, sets vidés) et à chaque `message_start` (`step_finalized=False`).

```
message_start (StreamEvent)  -> nouvelle in_flight d'étape + broadcast message_start ; step_finalized=False
text_delta    (StreamEvent)  -> accumule in_flight.text + broadcast text_delta
assistant     (AssistantMessage) -> _finalize_step(text=ev.text, tools=ev.tools)   # texte de l'EVENT
tool_result   (UserMessage)  -> persiste+broadcast tool_result ; _turn_tool_results.add(id)
result        (ResultMessage)-> _end_turn()
```
- **`_finalize_step(text, tools)`** (sous le verrou) : `if step_finalized: return` ; persiste `assistant_message(text, "success")` + broadcast `message_stop` ; **pour chaque tool** : persiste `tool_use{id,name,input}` + broadcast, `_turn_tool_ids.add(id)` ; `in_flight=None` ; `step_finalized=True`. 🛡️ Conserve la branche **« étape vide sans bulle »** du squelette (pas de `message_start` ⇒ pas d'`assistant_message` vide).
- **`_end_turn()`** (sous le verrou) : `if turn_finalized: return` ; `turn_finalized=True` ; capture/persiste `session` ; si une `in_flight` subsiste (interrupt avant `AssistantMessage`) → finalise `interrupted` (flag `stop_requested`, comme squelette) ; 🛡️ **balaye** `_turn_tool_ids − _turn_tool_results` → pour chaque id, persiste+broadcast `tool_result{id, is_error:true, output:"interrompu"}` (D8) ; dépile la file ou `idle`.
- **Invariants** inchangés (verrou d'état, broadcast borné D17, reattach atomique). `tool_use`/`tool_result` (réels et synthétiques) passent par le chemin durable+broadcast standard (seq'd).
- 🛡️ **`tool_result` tardif** (après `_end_turn`) : ignoré si `turn_finalized` (la carte est déjà close par le synthétique) — pas de ré-ouverture.

### 4.3 Wire & persistance

`messages.jsonl` gagne `tool_use{seq,type,ts,id,name,input}` et `tool_result{seq,type,ts,id,output,is_error}` (`output` toujours `str`, tronqué). Ordre typique : `user_message`, [`assistant_message`, `tool_use`(X)], `tool_result`(X), …, `session`. Appariement par `id`, indépendant de l'ordre ; dédup par `seq` au replay.

### 4.4 Front — `chat-model.js` & `chat-view.js`

- **`chat-model.js`** (pur) : `state.toolsById = {}` ; le dernier message assistant porte `tools: []` (liste d'ids). `reduce` : `assistant_message`/`message_stop` → fige l'étape, retient la référence du message courant pour y rattacher les outils ; `tool_use` → `toolsById[id] = {name, input, status:'running'}` + push l'id sur `tools` du message d'étape courant ; `tool_result` → `toolsById[id].status = is_error?'error':'done'`, `.output`. **Dédup par `seq`** (replay idempotent) — un `tool_use`/`tool_result` déjà vu (même `seq`) est ignoré.
- **`chat-view.js`** : sous le texte d'une bulle assistant, un bloc `.chat-tools` (mono) ; par id de `message.tools` → `TOOL_META[name]` (icône+couleur) + `fileArg(name,input)` + statut (`⟳`/`✓`/`✗`/`🚫`) ; clic → déplie `output`. `TOOL_META`/`fileArg` vivent dans `chat-view.js`.

## 5. SDK — surface tool & épinglage (D9)

Confirmé par la recherche (et **figé** par le smoke) : `tools=[…]` restreint le jeu ; le **hook `PreToolUse`** est le point de contrôle universel (≠ `can_use_tool`, court-circuitable) ; flux par étape `StreamEvent(message_start)` → `content_block_*` → `StreamEvent(message_stop)` → `AssistantMessage` (`TextBlock`+`ToolUseBlock(id,name,input)`) → exécution → `UserMessage(ToolResultBlock(tool_use_id, content, is_error))` → étape suivante ou `ResultMessage`. **Inconnus levés par le smoke** : noms d'attributs exacts ; `content` `str` vs `list[dict]` ; forme du dict de sortie du hook ; **forme réelle d'un deny** (ToolResultBlock(is_error) ou autre) ; comportement d'`interrupt()` en plein outil.

## 6. Cas limites & risques

- 🛡️ **Outils orphelins** (interrupt OU deny sans result) : **résolu** par le balayage de fin de tour (D8) → carte close (✗/🚫) live + replay. Testé.
- 🛡️ **Confinement Glob/Grep** : `pattern`/`glob` (et `path`) **vérifiés** ; **default-deny** par outil ; `cwd=repo_root` **obligatoire** borne les patterns relatifs ; le guard **ne lève jamais**.
- 🛡️ **`can_use_tool` court-circuité** : **résolu** en passant au hook `PreToolUse` (s'exécute pour tous les appels).
- 🛡️ **`ToolResultBlock.content`** `str`/`list[dict]`/`None` : coercion `_tool_output` → `str` (D4).
- **Smoke** doit prouver : in-repo passe **sans popup/hang** ; hors-repo **deny** ; guard **appelé**. Repo tmp + `setting_sources=[]` (isolation).
- **Windows** : `\` vs `/`, casse, lecteurs (`C:` vs `D:`) → `resolve().relative_to(root)`.
- **Confinement des PATTERNS de glob** (`Glob.pattern`, `Grep.glob`) : le moteur du SDK **expanse les accolades** avant résolution, donc `{..,ok}/**` énumère hors-repo alors que le pattern littéral « résout » in-repo. Ces champs passent par `_glob_inside` (deny tout `..`, et `_inside` sur **chaque arm** expansé), pas `_inside`.
- **Symlinks/junctions** : un lien fourni comme **chemin déclaré** (`file_path`/`path`) est sûr — `resolve()` le suit et `relative_to(root)` → **deny** s'il sort. En revanche la **traversée** d'un dossier in-repo par `Glob`/`Grep` (expansion `**`) suivant une junction **sortante** plantée dans le repo n'est **pas** gardée par le hook (elle dépend du moteur SDK) ; hypothèse de confinement : aucun lien sortant n'est introduit dans le repo (brique lecture seule → l'agent ne peut pas en créer).
- **output volumineux** (gros Read/Grep) : tronqué (borne) avant persistance/affichage.

## 7. Tests

- **Smoke** (`tests/integration/test_sdk_tools_smoke.py`, `@pytest.mark.integration`, repo tmp + `setting_sources=[]`) : Read in-repo → `ToolUseBlock(Read,file_path)` + `ToolResultBlock(is_error=False)` via `UserMessage`, `_tool_output` non vide ; multi-étapes ; tentative hors-repo → **guard appelé (compteur)** + deny + **capture** de la forme du result ; interrupt en plein outil (capture). Fige les noms d'attributs.
- **pytest (faux client)** : **guard** (`test_chat_guard.py`) — Read/LS sans chemin → deny ; chemin `""`/non-string → deny ; outil inconnu → deny ; in-repo (relatif+absolu) → allow ; `..` hors-repo → deny ; **Glob/Grep `pattern`/`glob` absolu hors-repo → deny**, relatif → allow, sans path → allow ; symlink hors-repo → deny ; ne lève jamais. **bridge** — multi-étapes (texte+tool_use puis texte final → 2 `assistant_message`, `tool_use`/`tool_result` appariés) ; **orphelin** (tool_use puis `result` avant tout tool_result → `tool_result` synthétique `is_error` persisté) ; `_tool_output` (str/list/None) ; persistance+replay ; **non-régression squelette** (tour texte-seul inchangé, étape vide sans bulle).
- **`node --test`** (`chat-model.test.js`) : `toolsById` pairing par id ; statuts ⟳→✓/✗ ; rattachement à la bonne bulle assistant ; dédup `seq` ; replay `[tool_use(X), tool_result(X,is_error)]` → carte `error` (pas `running`).
- **Playwright** : Claude lit le repo → cartes ⟳→✓ ; hors-repo → 🚫 ; interrupt en plein outil → carte ✗ (pas ⟳) ; reload → cartes rejouées (fermées) ; 0 erreur console.

## 8. Fichiers touchés

**Créés** : `mekistudio/backend/chat/guard.py` · `tests/integration/test_sdk_tools_smoke.py` · `tests/unit/test_chat_guard.py`. 🛡️ *(Tests à la racine `tests/`, pas `mekistudio/tests/`.)*
**Modifiés** : `backend/chat/options.py` (read-only + **hook PreToolUse** + `allowed_tools` + `cwd` + `setting_sources` ; `build_options(repo_root, store)` ; adaptateur → `tool_use`/`tool_result` + `_tool_output`) · `backend/chat/bridge.py` (multi-étapes `_finalize_step`/`_end_turn`, `repo_root`, balayage orphelins, suppression `_final_text` per-tour) · `backend/chat/manager.py` (passe `repo_root`) · `backend/chat/events.py` (builders `tool_use`/`tool_result`) · `frontend/static/js/chat-model.js` (`toolsById`) + `chat-model.test.js` · `frontend/static/js/chat-view.js` (`TOOL_META`/`fileArg`, mode C) · `frontend/static/css/canvas.css` (tool-cards) · `tests/unit/test_chat_bridge.py` (multi-étapes, orphelins, non-régression) · `docs/ROADMAP.md`.

## 9. Découpage en phases (entrée du plan)

**Phase 0** — smoke isolé (fige multi-étapes + ToolUse/ToolResult + **prouve le guard** + capture deny + interrupt-outil).
**Phase 1** — `guard.py` (hook durci) + `events.py` (tool builders) + `test_chat_guard.py` (headless, tous les cas).
**Phase 2** — adaptateur `options.py` (hook, read-only, `_tool_output`) + bridge multi-étapes (`_finalize_step`/`_end_turn`/orphelins) + tests bridge (multi-étapes, orphelin, non-régression, coercion).
**Phase 3** — `chat-model.js` (`toolsById`) + `node --test` ; `chat-view.js` (`TOOL_META`, mode C) + CSS.
**Phase 4** — Playwright. **Checkpoint.**

Chaque étape : test rouge → impl → vert → commit.

## 10. Hors périmètre / extensions

- **Brique Docker** : write/Edit/Bash + conteneur par session + clone + merge-back (`sandbox-isolation-research.md`). `TOOL_META` s'étend (Edit ambre, Write vert, Bash teal).
- **Modes A/B** + sélecteur réglages (`tool_card_style`).
- **Brique E (QCM)** : `AskUserQuestion`. **Brique F** : hooks → impulsions (cohabite avec le hook de confinement).
