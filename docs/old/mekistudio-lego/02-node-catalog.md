# Catalogue des nodes — types et composition

Chaque type de node (kind) est défini par un fichier `nodes/<kind>.py` qui déclare un `NodeDef` via `@node_def`. Ci-dessous, chaque kind est décrit par son rôle, sa structure de briques, et ses particularités de lifecycle.

---

## `chat`

**Rôle** : Session de chat avec Claude. C'est le node central du canvas, celui autour duquel les autres s'organisent.

**Structure de briques** (assemblage complet en primitives) :
```
NodeFrame "root"
  ├── FloatingTitle "title"    — badge "chat" au-dessus du node (accent violet)
  ├── HeaderBar "header"       — statut de connexion + statut de session
  ├── ScrollArea "scroll"
  │     └── MessageList "messages"  — bulles de messages
  └── TextComposer "composer"  — input de saisie + bouton Envoyer
```

**Données et dépendances** : la logique métier (envoi, streaming, état de connexion) est gérée par le factory Alpine `chatController`. Les briques héritent de son état via la portée x-data parente d'Alpine.

**Lifecycle** : node statique, créé au boot du canvas. Persiste dans `canvas.json`.

---

## `mekicore`

**Rôle** : Hub central du projet, affiché directement sous le node chat. Affiche les actions git principales (fetch, sync, etc.) et le nom du projet.

**Structure de briques** :
```
mekicore_root "root"   — brique root monolithique
```

**Données et dépendances** : hérite de `projectCanvas()` via Alpine (accès à `git`, `gitFetch`, `gitSync`, `primaryBranch`, etc.). La factory `mekicoreRootBrick` n'expose que `brick` et `node` pour l'introspection.

**Lifecycle** : node statique. Position : y = chat.y + chat.h + 60 (soit y=760 par défaut).

---

## `worktrees_hub`

**Rôle** : Badge compact affichant le nombre de worktrees actifs. Affiché sous mekicore uniquement quand au moins un worktree existe.

**Structure de briques** :
```
worktrees_hub_root "root"   — badge avec compteur
```

**Données et dépendances** : lit `node.count` depuis le scope Alpine parent.

**Lifecycle** : node statique, omis si aucun worktree. Position par défaut : x=225, y=1040.

---

## `git` (git_panel)

**Rôle** : Panel git principal. Affiche le graphe de commits, les branches, les actions git (fetch, pull, push, merge, créer une branche, ouvrir un worktree depuis un commit).

**Structure de briques** :
```
git_root "root"   — brique root monolithique (inlines le markup legacy)
```

**Données et dépendances** : hérite de `projectCanvas()` (accès à `git.graph`, `gitFetch`, `gitPull`, `gitPush`, `gitMergeBranch`, `openCreateBranchPrompt`, `gitTotalCommits`, `openWorktreeFromCommit`, `formatCommitDate`, `toggleSegment`).

**Lifecycle** : node statique. Position par défaut : x=720, y=320.

---

## `git_status`

**Rôle** : Panel compact listant les entrées du working tree (fichiers modifiés, new, deleted).

**Structure de briques** :
```
git_status_root "root"   — liste des entrées git status
```

**Données et dépendances** : hérite de `projectCanvas()` (`git.status`).

**Lifecycle** : node statique. Position par défaut : x=720, y=0.

---

## `git_diff`

**Rôle** : Badge tuile affichant le nombre de fichiers diff (grand chiffre + légende "diff"). Même forme visuelle que `worktrees_hub`.

**Structure de briques** :
```
git_diff_root "root"   — badge compteur
```

**Données et dépendances** : hérite de `projectCanvas()` (`git.status.length`).

**Lifecycle** : node statique. Position par défaut : x=1280, y=552.

---

## `file`

**Rôle** : Badge représentant un fichier nouveau ou non-tracké dans le diff git.

**Structure de briques** :
```
file_root "root"   — badge fichier (accent vert)
```

**Données et dépendances** : hérite de `projectCanvas()` (`files`, `fileStats`, `basename`, `folder`). Le partial Jinja branche sur `node.kind` pour choisir l'accent couleur.

**Lifecycle** : node **dynamique** — créé à la volée par `_syncFileNodes()` dans `app.js` à partir de `git status`. Non persisté via `CanvasService`. Coordonnées calculées par le tree-layout du diff-panel. Dimensions par défaut : 240×140.

---

## `file_diff`

**Rôle** : Badge représentant un fichier modifié (diff). Variante colorée de `file`.

**Structure de briques** :
```
file_root "root"   — badge fichier (accent amber, pour "modifié")
```

**Données et dépendances** : identiques à `file`. La distinction visuelle (amber vs vert) est portée par `node.kind` dans le template Jinja.

**Lifecycle** : identique à `file` — dynamique, non persisté, généré par `_syncFileNodes()`.

---

## `file_del`

**Rôle** : Badge représentant un fichier supprimé. Variante rose de `file`.

**Structure de briques** :
```
file_root "root"   — badge fichier (accent rose, pour "supprimé")
```

**Données et dépendances** : identiques à `file`.

**Lifecycle** : identique à `file` — dynamique.

---

## `terminal`

**Rôle** : Terminal interactif (PTY) attaché à un worktree. Créé à la demande depuis la toolbar flottante d'un node chat.

**Structure de briques** :
```
terminal_root "root"   — wrapper terminal (enveloppe le terminalController Alpine)
```

**Données et dépendances** : monte un scope `terminalController({...})` x-data propre. Accède à `status`, `cwd`, `shell`, `worktreeBranch`, `termMount`, `close()` via ce controller. Le lifecycle PTY (processus distant, relay WebSocket) est géré côté backend indépendamment des briques.

**Lifecycle** : node **dynamique** — créé par `newTerminalForSelectedChat()` dans `app.js`. Non persisté dans `CanvasService` (les bounds et l'identifiant terminal sont calculés au runtime).

---

## `branches_viz`

**Rôle** : Visualiseur SVG de la topologie des branches (arbre des branches, relations d'ancêtres).

**Structure de briques** :
```
branches_viz_root "root"   — brique root monolithique (SVG lourd)
```

**Données et dépendances** : hérite de `projectCanvas()` (`branchesTopo`, `branchesViz`, `refreshBranchesTopo`, `_renderBranchesViz`).

**Lifecycle** : node statique. Position par défaut : x=1480, y=0. La décomposition en sous-briques (header / SVG / légende) est différée à une phase ultérieure.

---

## `diff_panel`

**Rôle** : Cadre visuel en tirets qui encadre l'ensemble des file nodes. Fournit le fond + le titre pill "files diff". Ne porte pas de données propres.

**Structure de briques** :
```
diff_panel_root "root"   — cadre + titre pill
```

**Données et dépendances** : aucune donnée propre. Cadre visuel uniquement.

**Lifecycle** : node **dynamique** — créé par `_ensureDiffPanelNode()` dans `app.js` quand au moins un file node existe. Sa position et taille sont recalculées par `_updateDiffPanelBounds()` pour envelopper le cluster de fichiers.

---

## `worktree_chat`

**Rôle** : Variante du node chat pour un worktree git. Ajoute au-dessus une étiquette worktree (branche + label) et en bas une barre d'actions worktree (merge / abandon + indicateurs ahead/behind).

**Structure de briques** :
```
worktree_chat_root "root"
  — inlines les sous-briques chat (chat_header / chat_messages / chat_composer)
  — wrappées dans chatController() x-data
  — plus le label worktree flottant et les boutons merge/abandon
```

**Réutilisation** : ce node valide le principe de réutilisation des briques lego — il partage 90 % de sa structure DOM avec le node `chat`, tout en ajoutant ses propres wrappers structurels. C'est le test proof-of-concept de la composabilité.

**Données et dépendances** : monte un `chatController({...})` propre, plus les data worktree (`worktreeBranch`, `worktreeLabel`, `ahead`, `behind`). Les actions merge/abandon dispatchent des `CustomEvent` Alpine capturés par le canvas parent.

**Lifecycle** : node **dynamique** — créé par `projectCanvas()` en itérant sur `worktreeSummaries`. Non persisté.

---

## Récapitulatif

| Kind | Lifecycle | Brique root | Briques primitives ? | Dynamique ?|
|------|-----------|-------------|----------------------|------------|
| `chat` | statique | `NodeFrame` (full primitives) | Oui — 5 primitives | Non |
| `mekicore` | statique | `mekicore_root` | Non | Non |
| `worktrees_hub` | statique | `worktrees_hub_root` | Non | Non |
| `git` | statique | `git_root` | Non | Non |
| `git_status` | statique | `git_status_root` | Non | Non |
| `git_diff` | statique | `git_diff_root` | Non | Non |
| `file` | dynamique | `file_root` | Non | Oui — _syncFileNodes |
| `file_diff` | dynamique | `file_root` | Non | Oui — _syncFileNodes |
| `file_del` | dynamique | `file_root` | Non | Oui — _syncFileNodes |
| `terminal` | dynamique | `terminal_root` | Non | Oui — toolbar chat |
| `branches_viz` | statique | `branches_viz_root` | Non | Non |
| `diff_panel` | dynamique | `diff_panel_root` | Non | Oui — _ensureDiffPanelNode |
| `worktree_chat` | dynamique | `worktree_chat_root` | Partielles | Oui — worktreeSummaries |

**Note sur les "non primitives"** : la majorité des kinds gardent une brique root monolithique qui inlines le markup Jinja hérité (stratégie de migration pragmatique). Le node `chat` est le seul fully décomposé en primitives à ce stade — il sert de modèle pour la décomposition future des autres kinds.
