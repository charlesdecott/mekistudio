# 06 — Worktrees git par projet

## Concept

Chaque projet mekistudio peut avoir plusieurs **worktrees git** actifs simultanément. L'idée est d'associer un espace de travail Claude isolé à chaque branche de développement parallèle : une conversation, un état de canvas, un contexte d'agent — tout est séparé par worktree. Cela rend possible des expérimentations sans polluer la branche principale, et des conversations distinctes sur des features différentes dans la même session de studio.

---

## Isolation

Un worktree crée deux répertoires distincts, délibérément séparés :

- **Le répertoire git** (`~/.mekistudio/projects/<id>/git-worktrees/<slug>/`) : créé par `git worktree add`, contient les fichiers de travail de la branche. Il vit hors du repo pour ne pas apparaître comme répertoire non-tracké dans le dépôt principal.
- **Le répertoire d'état** (`~/.mekistudio/projects/<id>/worktrees/<slug>/`) : contient l'historique de conversations, le canvas et les logs. Il vit hors du repo pour ne pas polluer `git status`, et hors du répertoire git pour **survivre à la suppression du worktree** après un merge.

Cette séparation répond à un invariant important : l'historique de chat d'une feature doit rester consultable même après que la branche est mergée et le worktree supprimé.

---

## Store de labels

Les branches ont des noms canoniques git (`feat/canvas-files`, `fix/ws-reconnect`). Le studio permet d'y attacher un **label cosmétique** libre ("refonte canvas", "hotfix auth") stocké dans `~/.mekistudio/projects/<id>/worktree-labels.json`, sans jamais toucher le nom de branche réel. Renommer dans le studio est donc une no-op git.

---

## Orchestration `git worktree add`

La création d'un worktree via `WorktreeStore.create(branch, base=None)` suit cette logique :

1. Validation du nom de branche (caractères autorisés, unicité dans la liste courante).
2. Vérification que le repo a au moins un commit (un HEAD unborn bloque l'opération avec un message clair).
3. Si la branche existe déjà localement : `git worktree add <path> <branch>` (checkout de l'existante).
4. Si la branche n'existe pas : `git worktree add -b <branch> <path> <base_ref>` (création depuis `base`, défaut = branche primaire).

La suppression utilise `git worktree remove --force` avec une logique de retry exponentielle (problème Windows : les handles de sous-processus sont relâchés de façon asynchrone, ce qui peut bloquer le répertoire pendant quelques centaines de millisecondes). En dernier recours, un `rmtree` manuel suivi d'un `git worktree prune` remet git dans un état cohérent.

---

## Cycle de vie complet

```
create(branch)
    → git worktree add
    → répertoire d'état créé à la demande
    ↓
utilisation (conversations, canvas, agent)
    ↓
merge_to_primary(branch)
    → git merge --no-ff dans le repo principal
    → retour de dirty_changes pour le prompt de confirmation
    ↓
remove(branch, delete_branch=True)
    → git worktree remove (avec retry)
    → git branch -D
    → suppression du répertoire d'état (optionnelle : drop_state=False pour garder l'historique)
```

---

## Pourquoi

Sans worktrees, travailler sur deux features en parallèle forcerait soit à switcher de branche (perdant le contexte en cours), soit à ouvrir plusieurs terminaux et gérer manuellement des `git stash`. Le worktree git résout le problème à la couche système de fichiers : les deux branches coexistent dans deux répertoires, chacun avec son propre Claude en train de coder. Le studio n'a plus qu'à router les conversations vers le bon `cwd`.

---

## Topologie sur le canvas

Le canvas principal du projet (branche primaire) affiche un node `worktrees_hub` dès qu'il y a au moins un worktree actif. Chaque worktree est représenté par un node `worktree_chat` séparé, avec son propre chatController connecté à la conversation de ce worktree. La topologie est calculée au chargement et recalculée à chaque changement de liste de worktrees.
