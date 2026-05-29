# Canvas runtime — API, WebSocket, rendu et hot-reload

---

## Architecture générale

Le runtime du canvas repose sur trois couches qui communiquent à sens unique :

```
Fichiers Python/YAML  ──┐
API REST               ──┤──▶ CanvasService ──▶ persist ──▶ canvas.json
UI mode "build"        ──┘         │
                                   └──▶ WSHub.broadcast ──▶ clients connectés
```

`CanvasService` est le **seul point de mutation**. Toute modification — qu'elle vienne d'un fichier édité, d'un appel API, ou d'un clic dans l'interface — passe par lui. La séquence est toujours : `validate → apply (en mémoire) → persist → broadcast`.

Cette architecture garantit trois propriétés :
- **Atomicité** : pas d'état intermédiaire visible. Si la validation échoue, rien n'est appliqué.
- **Cohérence multi-onglets** : toute mutation est immédiatement broadcastée à tous les clients connectés (< 50 ms).
- **Résilience** : une erreur Pydantic ne crashe jamais le canvas. L'ancien état reste actif et un toast d'erreur est affiché.

---

## `canvas_api.py` — la surface REST

Montée sous le préfixe `/api/canvas`. Toutes les routes délèguent à `CanvasService` ; les erreurs `ValueError` (requête invalide) et `KeyError` (ressource introuvable) sont toutes les deux mappées en HTTP 422.

### Endpoints read-only

| Route | Rôle |
|-------|------|
| `GET /api/canvas/registry` | Retourne la palette complète : tous les `BrickSpec` et tous les `NodeDef` built-in disponibles. Utilisé par le mode "build" pour remplir la palette, et par Claude pour connaître les kinds disponibles. |
| `GET /api/canvas/layout` | Retourne le `CanvasLayout` complet : tous les nodes avec leurs briques, câbles, et position. |

### Mutations nodes

| Route | Corps | Rôle |
|-------|-------|------|
| `POST /api/canvas/nodes` | `{kind, pos}` | Crée un node du kind donné à la position donnée. Si le kind a un template dans le registry, le NodeDef template est cloné avec un id unique. Sinon, un node avec une brique `legacy` est créé. |
| `PATCH /api/canvas/nodes/{id}` | `{pos?, title?}` | Déplace ou renomme un node. |
| `DELETE /api/canvas/nodes/{id}` | — | Supprime le node et nettoie les câbles cross-node qui le référençaient. |

### Mutations briques

| Route | Corps | Rôle |
|-------|-------|------|
| `POST /api/canvas/bricks` | `{node_id, spec, parent_id, props?}` | Insère une brique dans l'arbre d'un node existant. Valide le `spec` (doit être dans le registry) et le `required_parent` (si défini sur le spec, le parent doit être du bon kind). |
| `PATCH /api/canvas/bricks/{id}` | `{props}` | Met à jour les props d'une brique. |
| `DELETE /api/canvas/bricks/{id}` | — | Supprime la brique et ses enfants en cascade (toutes les briques dont `parent_id` la référence). La brique root d'un node ne peut pas être supprimée — il faut supprimer le node. |

### Mutations câbles

| Route | Corps | Rôle |
|-------|-------|------|
| `POST /api/canvas/wires` | `{source: {brick_id, port}, target: {brick_id, port}}` | Crée un câble. Valide que les deux ports existent, ont le même `PortKind`, et que le câble DATA ne crée pas de cycle. Le wire est attaché au node qui possède la brique source (les wires cross-node sont stockés avec leur node source). |
| `DELETE /api/canvas/wires/{id}` | — | Supprime un câble. |

### Sauvegarde custom

| Route | Corps | Rôle |
|-------|-------|------|
| `POST /api/canvas/save-as-node` | `{node_id, name}` | Sérialise un node existant en YAML dans `.mekistudio/nodes/<name>.yaml`. Le watcher le détectera et l'ajoutera automatiquement à la palette. Permet à un humain ou à Claude de sauvegarder un assemblage comme NodeDef réutilisable. |

---

## `canvas_ws.py` — le canal WebSocket

### `CanvasWSHub`

Un hub pub/sub simple vivant à l'échelle du module (`canvas_ws_hub_singleton`). Chaque connexion `/ws/canvas` ajoute un WebSocket à un `set` ; `broadcast(event: dict)` envoie le JSON sérialisé à tous les sockets connectés.

**Pourquoi module-level singleton ?** Le hub doit être la même instance partagée entre deux endroits : `CanvasService` (qui appelle `.broadcast()`) et l'endpoint `/ws/canvas` (qui appelle `.connect()` / `.disconnect()`). Un singleton de module est la solution la plus simple — injectable via `deps.get_canvas_service()`.

**Gestion des sockets morts** : lors du broadcast, les sockets dont `send_text()` lève une exception sont collectés et déconnectés silencieusement. Le set est snapshotté avant l'itération pour éviter la mutation concurrente.

### Les événements broadcastés

| Type | Contenu | Déclencheur |
|------|---------|-------------|
| `canvas/changed` | `{patch: {...}}` | Toute mutation via `CanvasService`. Le patch est chirurgical : `node_added`, `node_removed`, `node_patched`, `brick_added`, `brick_removed`, `brick_patched`, `wire_added`, `wire_removed`. |
| `canvas/registry-updated` | — | Un reload du registry a réussi (fichier Python ou YAML modifié, ou `save-as-node` exécuté). Les clients rafraîchissent la palette. |
| `canvas/error` | `{errors: [...]}` | Un reload du registry a échoué (erreur Pydantic, erreur d'import). L'ancien état reste actif. |

### Réception côté client

Le client n'envoie rien de significatif sur ce WebSocket. La boucle de réception existe uniquement pour détecter la déconnexion. Toutes les mutations partent par les endpoints REST.

---

## Les modèles Pydantic comme source de vérité

La persistance s'appuie directement sur Pydantic v2 :
- **Lecture** : `CanvasLayout.model_validate_json(canvas.json)`. Si le JSON est invalide, le service démarre avec un canvas vide (pas de crash).
- **Écriture** : `layout.model_dump(mode="json")` → `json.dumps(..., indent=2)` → `canvas.json`.
- **Migration** : au boot, si le fichier est dans l'ancien format (dict de positions), `converter.convert_canvas_json_in_place()` le transforme en place avant la lecture. Idempotent.

---

## Comment les briques sont rendues

### Côté Jinja

`project_canvas.html` itère sur `nodes` avec `x-for`. Pour chaque node, il inclut le partial Jinja correspondant au kind via `{% include "bricks/<kind>_root.html" %}` dans un `<template x-if>` Alpine. Cette approche — Jinja include au lieu de `x-html` — est délibérée : Alpine traite toutes les directives (`x-data`, `x-bind`, etc.) nativement sur les éléments injectés par Jinja. `x-html` injecterait du HTML inerte qu'Alpine ne peut pas initialiser.

Après la migration complète (PR11), chaque kind a son `<template x-if>` correspondant ; le grand monolithe de conditions est divisé en 11 blocs propres de 1 à 3 lignes chacun.

### Côté Alpine / JavaScript (`bricks.js`)

`window.bricks` est un dictionnaire `kind → factory`. Chaque factory Alpine est une fonction `(brick, node) → state object`. Le rendu récursif `renderBrickTree(node, root)` :
1. Résout la factory depuis `window.bricks[root.spec]`.
2. Sérialise `brick` et `node` en JSON dans un attribut `x-data` que Alpine évalue au mount.
3. La factory reçoit l'objet brique et l'objet node entier — elle peut donc retrouver ses enfants en filtrant `node.bricks.filter(b => b.parent_id === brick.id)`.

Si un spec est inconnu, un fallback visuel minimal est rendu (div gris avec le nom du spec).

### `applyCanvasPatch(canvas, patch)`

Fonction globale appelée par le handler WebSocket du client à chaque `canvas/changed`. Applique chirurgicalement le patch sur `canvas.nodes` (l'array Alpine live) :
- **Déduplication** : les `node_added` et `brick_added` vérifient d'abord si l'id existe déjà, car le mode build fait une insertion locale optimiste avant que le broadcast WebSocket n'arrive.
- **Propagation Alpine** : toute modification d'un element du tableau déclenche la réactivité Alpine naturellement (pas de `$nextTick` ni de `forceUpdate` nécessaires).

---

## Hot-reload de bout en bout

### Le watcher (`hot_reload.py`)

Une task asyncio est démarrée dans le lifespan FastAPI. Elle observe en continu :
- `packages/backend/canvas/bricks/` — les specs de briques Python.
- `packages/backend/canvas/nodes/` — les templates de nodes Python.
- `.mekistudio/nodes/` — les NodeDef custom YAML de l'utilisateur.

Dès qu'un changement est détecté (debounce 50 ms via `watchfiles.awatch`) :
1. `registry.reload()` est appelé — vide le registry, reimporte les modules Python, rescanne les YAML.
2. Si succès : broadcast `canvas/registry-updated`.
3. Si erreur : broadcast `canvas/error` avec les messages d'erreur. L'ancien état reste en place.

### Garanties de timing

- Modification fichier visible côté client : < 200 ms (latence watcher + parse + broadcast).
- Mutation REST visible côté autres onglets : < 50 ms.

### Garantie d'identité après reload

Le registry ne stocke jamais de référence directe à une classe Python. Après `importlib.reload`, les nouvelles classes ré-décorent via `@brick_spec` et enregistrent de nouveaux objets `BrickSpec` sous les mêmes clés `kind`. Les briques déjà instanciées sur le canvas (qui portent uniquement le `kind` string) passent automatiquement à la nouvelle définition de spec — sans qu'aucun client ne soit déconnecté et sans full re-render.

---

## Le mode "build" — UI comme thin client

La palette de build est une interface réactive qui affiche les résultats de `GET /api/canvas/registry`. Chaque clic :
- "Créer un node" → `POST /api/canvas/nodes`.
- "Ajouter une brique" → `POST /api/canvas/bricks` avec le node sélectionné comme cible.

L'UI ne contient aucune logique de validation propre. Toute la logique métier est dans `CanvasService`. Claude (ou tout script) peut utiliser exactement les mêmes endpoints pour piloter le canvas programmatiquement.
