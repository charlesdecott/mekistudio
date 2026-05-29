# 04 — Claude Bridge

## Concept

Un **bridge** est la couche qui traduit le Claude Agent SDK en événements normalisés, adaptés au transport WebSocket de l'interface. La règle centrale est : **un bridge = une conversation**. Il est créé à l'attachement d'un chat, gardé vivant en arrière-plan pendant toute la durée de la session (même si l'utilisateur ferme l'onglet et revient), et détruit uniquement sur arrêt explicite.

La justification : le SDK maintient en mémoire le contexte de la conversation (tool calls, fichiers lus, décisions). Le recréer à chaque reconnexion WebSocket ferait repartir Claude de zéro.

---

## Hooks du Claude Agent SDK capturés

Le bridge s'abonne à **tous** les hooks que le SDK expose, répartis en deux catégories :

| Hook | Déclenchement |
|---|---|
| `PreToolUse` | Juste avant qu'un outil soit exécuté |
| `PostToolUse` | Après une exécution réussie |
| `PostToolUseFailure` | Après une exécution en erreur |
| `UserPromptSubmit` | Quand l'utilisateur soumet un prompt |
| `Stop` | Quand l'agent s'arrête |
| `SubagentStart` / `SubagentStop` | Cycle de vie des sous-agents (Task) |
| `PreCompact` | Avant une compaction de contexte |
| `Notification` | Notifications diverses du SDK |
| `PermissionRequest` | Demande de permission liée à un tool |

Chaque hook déclenche un événement `HookFired` qui est relayé au panneau "hooks" de l'interface, en parallèle du flux chat principal. Cela donne une visibilité totale sur tous les signaux Claude, même ceux qui ne produisent pas de texte visible.

---

## `can_use_tool` — la bifurcation centrale

Le callback `can_use_tool` du SDK est le point de contrôle unique pour toutes les invocations d'outils :

- **`AskUserQuestion`** : le bridge émet un événement `AskUserPrompt` vers l'interface et suspend la coroutine via un `asyncio.Future`. La conversation est bloquée jusqu'à ce que l'utilisateur réponde depuis l'UI ; la réponse est injectée en retour dans le SDK comme `updated_input`. Ce mécanisme permet au modèle de poser des questions structurées (single-select, multi-select, texte libre) qui interrompent proprement le flux.
- **Tous les autres outils** : ils passent par le guard de worktree (voir ci-dessous), puis sont auto-autorisés (`PermissionResultAllow`) sans interaction humaine. Le mode `acceptEdits` du SDK évite les popups interactifs ; le studio est lui-même la porte d'autorisation.

---

## Le guard (WorktreeGuard)

Le guard est instancié avec un `allowed_root` (le répertoire de travail du worktree courant) et une liste optionnelle de `forbidden_roots` (les autres worktrees du projet).

Politique par type d'outil :

- **Write / Edit / MultiEdit / NotebookEdit** : le chemin cible doit être à l'intérieur de `allowed_root`. Un chemin vers un `forbidden_root` produit un message d'erreur explicite.
- **Bash** : les flags `git -C`, `--git-dir`, `--work-tree` sont bloqués (ils réorienteraient git vers un autre dépôt). Les `cd <cible>` sont validés. Toute mention d'un `forbidden_root` en sous-chaîne de la commande est bloquée.
- **Read / Grep / Glob / WebFetch / ...** : lecture libre, sans restriction. La frontière de sécurité concerne les mutations, pas les lectures.

Les refus sont mirrorés dans le panneau hooks avec un événement `PermissionRequest { decision: "deny" }` pour que l'utilisateur comprenne pourquoi un tool call a disparu silencieusement.

---

## Types d'événements normalisés émis

Le bridge traduit les messages bruts du SDK en un vocabulaire unifié :

| Type | Sens |
|---|---|
| `AgentStart` | Le bridge est prêt |
| `AgentEnd` | Tour terminé (`stop_reason`, ex. `end_turn`) |
| `AgentError` | Crash du reader loop |
| `MessageStart` | Début d'un message assistant (affiche les points de frappe) |
| `MessageEnd` | Fin du message |
| `TextDelta` | Fragment de texte streamé |
| `ThinkingDelta` | Fragment de raisonnement étendu (extended thinking) |
| `ToolCallStart` | Début d'un appel d'outil |
| `ToolCallEnd` | Fin d'un appel, avec résultat ou erreur |
| `AskUserPrompt` | Question structurée en attente de réponse UI |
| `HookFired` | Signal hook brut (panneau latéral) |
| `SessionId` | Identifiant de session SDK à persister (pour reprise) |

Le streaming token-par-token est obtenu via `include_partial_messages=True` qui expose les `content_block_delta` de l'API Anthropic. Le thinking étendu est activé en mode `adaptive` (le modèle décide).

---

## NullBridge

Alternative sans LLM, utilisée quand aucune clé API n'est configurée ou dans les tests. Elle implémente la même interface (`start`, `send`, `stop`, `events`) et émet les mêmes formes d'événements normalisés. Elle propose des commandes de test internes (`/ask`, `/stream`, `/think`, `/tool`) pour exercer chaque type d'affichage de l'interface sans connexion réseau.
