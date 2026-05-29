# Le système de briques — modèle de composition

---

## Principes fondamentaux

Le système repose sur un **modèle dual** :

- **Contenance (arbre)** — chaque `Brick` porte un `parent_id` qui pointe vers une autre brique du même node. Exactement une brique par node n'a pas de parent (la racine).
- **Connexions (graphe)** — des `Wire` relient des ports de sortie à des ports d'entrée, éventuellement entre deux nodes différents (cross-node wires).

Ce modèle dual permet à la fois d'organiser visuellement les briques (l'arbre structure la mise en page) et de faire circuler des données ou des événements entre elles (le graphe de câbles).

---

## Les modèles Pydantic (`models.py`)

### Ports et câbles

**`PortKind`** — trois types de flux :
- `data` : valeur continue et observable (ex : statut git mis à jour en continu).
- `event` : impulsion avec payload (ex : message envoyé).
- `trigger` : impulsion sans payload (ex : horloge, tick).

Un câble ne peut connecter que deux ports du même `PortKind`. Les cycles `data` sont rejetés (ils causeraient une propagation infinie) ; les cycles `event` et `trigger` sont autorisés (utiles pour du polling ou du debouncing).

**`PortSpec`** — décrit un port : nom, kind, payload Pydantic optionnel (nom qualifié du modèle transporté), flag `multiple` (accepte plusieurs câbles).

**`Wire`** — relie un `BrickPort` source à un `BrickPort` cible. Le `kind` est persisté (dérivé des ports, mais conservé pour éviter une résolution à la lecture).

### Briques

**`BrickSpec`** — le *type* d'une brique. Déclaré une fois en Python via le décorateur `@brick_spec`. Contient : `kind` (identifiant unique), `label`, `required_parent` (kind du parent exigé, ou `None`), listes d'inputs/outputs, `render_template` (chemin du partial Jinja), `alpine_factory` (nom de la factory Alpine).

**`Brick`** — l'*instance* d'une brique dans un node. Sérialisable et persistée. Contient : `id`, `spec` (référence à `BrickSpec.kind` par string — jamais par référence directe à la classe), `parent_id`, `props` (dictionnaire libre de configuration), `pos` optionnel.

La distinction spec/instance est fondamentale : le spec est le type (défini une fois), l'instance est l'occurrence concrète dans un arbre de node.

### Nodes et canvas

**`NodeDef`** — un node complet : id, kind, titre optionnel, liste de briques, liste de câbles, position sur le canvas. Validé au chargement :
- exactement une brique sans `parent_id` (la racine) ;
- tout `parent_id` non-null pointe vers une brique du même node ;
- les câbles intra-node ont leurs deux extrémités dans le node.

**`CanvasLayout`** — liste des nodes positionnés + état de la vue (pan, zoom).

---

## Hiérarchie des classes Python (`_base.py`)

Les briques Python suivent une hiérarchie de classes qui encode leur rôle :

```
BrickBase
  ├── DisplayBrick          — rendu pur, pas de ports, pas de behavior
  │     └── ContainerBrick  — affiche + contient des enfants via parent_id
  └── InteractiveBrick      — émet des événements Alpine upstream
        └── BehaviorBrick   — émet + exécute une coroutine serveur
```

- **`DisplayBrick`** : titres, badges, textes statiques. Lit ses données depuis `brick.props` et la portée Alpine parente.
- **`ContainerBrick`** : brique display qui organise ses enfants. Le template Jinja est responsable de leur mise en page.
- **`InteractiveBrick`** : dispatche des `CustomEvent` Alpine vers la portée parente (formulaire envoyé, bouton cliqué). Pas de behavior serveur.
- **`BehaviorBrick`** : définit une coroutine `async behavior(self, ctx: BrickCtx)` qui s'exécute côté serveur pour la durée de vie de la brique (lancée au mount, annulée à l'unmount).

---

## Le décorateur `@brick_spec` et le registry

### `@brick_spec`

Décorateur de classe. Il lit `render_template`, `alpine_factory` et `behavior` sur la classe décorée, construit un `BrickSpec` Pydantic, et l'enregistre dans le `CanvasRegistry`. Il estampille aussi la classe d'un attribut `.KIND` — ce qui permet aux factories de NodeDef d'écrire `Brick(spec=NodeFrame.KIND)` au lieu de dupliquer la chaîne `"node_frame"`.

```
@brick_spec(kind="node_frame", label="Node frame")
class NodeFrame(ContainerBrick):
    render_template = "bricks/primitives/node_frame.html"
    alpine_factory = "nodeFrameBrick"
```

### `@node_def`

Décorateur de fonction. La fonction décorée retourne un `NodeDef` complet (l'arbre de briques, les câbles, la position par défaut). Ce NodeDef est enregistré dans le registry comme template de référence pour ce kind.

### `CanvasRegistry`

Singleton chargé au boot. Stocke trois tables indexées par string :
- `dict[kind → BrickSpec]` — les specs de briques.
- `dict[kind → BehaviorFn]` — les coroutines de behavior.
- `dict[kind → NodeDef]` — les templates de nodes built-in.

**Règle d'identité** : toute référence à un BrickSpec passe par son `kind` string. Jamais par référence directe à la classe. Cette règle permet à `importlib.reload` de fonctionner : quand un module est rechargé, les nouvelles classes ré-enregistrent de nouveaux `BrickSpec` sous les mêmes clés, et les briques déjà instanciées sur le canvas les prennent automatiquement en compte.

**`reload(yaml_dirs, python_modules)`** : vide le registry, reimporte les modules Python via `importlib.reload`, rescanne les répertoires YAML. Les erreurs sont collectées et retournées sans jamais faire crasher le canvas.

**`scan_yaml(directory)`** : parse chaque fichier `.yaml` du répertoire comme un `NodeDef`. Les fichiers invalides sont ignorés (erreur loggée, pas d'exception).

---

## Les primitives (`bricks/primitives/`)

Les primitives sont des briques UI réutilisables qui ne dépendent d'aucun node en particulier. Elles sont assemblées par les factories de NodeDef pour composer les nodes.

| Brique | Classe de base | Rôle |
|--------|---------------|------|
| `NodeFrame` | `ContainerBrick` | Wrapper structurel racine de tout node. Fournit la colonne flex qui contient les enfants. Lit `brick.props["accent"]` pour le thème couleur. |
| `FloatingTitle` | `DisplayBrick` | Grande étiquette flottante au-dessus d'un node (ex : le badge "chat"). Props : `text`, `accent`, `size`. |
| `HeaderBar` | `DisplayBrick` | Barre de statut en haut d'un node (label à gauche, slot optionnel à droite). Props : `label`, `right_slot` (`connection_status` ou `none`). |
| `ScrollArea` | `ContainerBrick` | Conteneur scrollable vertical (flex-1, overflow). Utilisé comme corps de tout node dont le contenu peut dépasser sa hauteur. |
| `MessageList` | `DisplayBrick` | Bulles de messages style chat. Lit `messages` dans la portée Alpine parente. Props : `empty_text`. |
| `TextComposer` | `InteractiveBrick` | Input texte + bouton Envoyer. Appelle `send()` sur la portée parente. Props : `placeholder`, `submit_label`, `accent`. |
| `ActionsBar` | `InteractiveBrick` | Rangée horizontale de boutons génériques en bas d'un node. Chaque bouton dispatche un `CustomEvent` configuré via `props.buttons`. |

---

## Les `*_root` — assemblages par type de node

Pour chaque kind de node, un fichier `*_root.py` dans `bricks/` déclare la brique racine. Ces briques root sont le point d'entrée du rendu côté template Jinja : `project_canvas.html` inclut le partial `bricks/<kind>_root.html` selon le kind du node.

Pour les nodes complexes (comme `chat`), les nodes files dans `nodes/` utilisent directement les classes des primitives importées en Python pour composer l'arbre complet de briques. La brique root n'est plus un monolithique mais le sommet d'un arbre typé.

La brique `legacy` est un cas particulier : c'est une brique placeholder utilisée par le convertisseur one-shot de l'ancien format `canvas.json`. Elle est remplacée par de vraies briques au fur et à mesure de la migration de chaque kind.

---

## Le `converter.py`

Lors du premier boot après la migration, si le fichier `canvas.json` est encore dans l'ancien format (dictionnaire `{kind: {x, y, w, h}}`), le converter le transforme en place vers le nouveau format (`nodes: [NodeDef serialisé]`). Chaque ancien entry devient un `NodeDef` avec une brique root `legacy` comme placeholder. L'opération est idempotente : si le format est déjà le nouveau, rien n'est touché.

---

## Le `hot_reload.py`

Un task asyncio de longue durée surveille les fichiers sources des briques et nodes (`watchfiles.awatch` avec debounce 50 ms). Sur toute modification :

1. `registry.reload()` est appelé — vide le registry et reimporte tout.
2. Si le reload réussit, un broadcast WebSocket `canvas/registry-updated` est émis — les clients savent que la palette a changé.
3. Si une erreur Pydantic ou d'import se produit, un broadcast `canvas/error` est émis avec les messages d'erreur, et l'état précédent reste actif. Le canvas ne crashe jamais.

Trois sources de changement convergent donc toutes vers le registry : édition fichier (watcher), API REST (service), et UI mode build (fine couche sur l'API REST).
