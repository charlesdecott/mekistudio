# Spec — Câbles/wires & impulsions

> Date : 2026-05-29 · Statut : design validé (brainstorming + compagnon visuel) → **durci par revue adversariale** → à transformer en plan.
> Origine : idée notée dans [`docs/IDEAS.md`](../../IDEAS.md) (« Canvas — relier les nodes avec une logique (wires) »).
> Réfs visuelles : [`docs/raw/cables/ue5_cablemanagement.md`](../../raw/cables/ue5_cablemanagement.md) (styles UE5) ;
> concept « pulses » de l'ancienne version : [`docs/old/mekistudio/05-canvas.md`](../../old/mekistudio/05-canvas.md).
> **Durci par une revue adversariale** (4 relecteurs : géométrie, intégration front, modèle/backend, impulsions + 1 critique de
> complétude). Les corrections issues de cette revue sont intégrées et signalées par 🛡️.

## 1. Problème & vision

Le canvas affiche des nodes (`kernel`, `fileexplorer`, `fileeditor`) mais **aucun lien
visible** : `CanvasState.edges` est réservé (`list[dict]`) et **vide**
(`backend/models.py` l.50), il n'y a **ni layer SVG, ni ports/pins** côté front.

On veut **matérialiser le flux d'information** par des **câbles** : le `kernel` est relié
au `fileexplorer`, lui-même relié à chaque `fileeditor` ouvert. Les câbles se **créent au
spawn** d'un node et se **recalculent automatiquement** quand on bouge/redimensionne les
nodes. Plus tard, une **impulsion lumineuse** parcourt ces câbles pour montrer où va
l'information (le chat modifie un fichier → l'éditeur s'ouvre et s'illumine).

Style retenu (validé en maquette) : **subway 45° net**, **néon (halo)**, **ancrage
adaptatif** (le câble sort du côté le plus proche), **ruban** (les câbles d'un même côté
sont des lanes parallèles, jamais superposées **au voisinage d'un node partagé** — un
croisement ponctuel est toléré, pas une confusion sur une portion).

## 2. Objectifs / non-objectifs

**Objectifs**
- **1 câble par node** : chaque node (sauf la racine) a exactement **un** câble vers son
  **parent logique** (`source_id`). Le graphe est **dérivé** de ces liens.
- Câbles **créés au spawn**, **supprimés** avec le node, **re-routés** au
  **déplacement / redimensionnement / spawn / suppression / chargement**.
- **Routage adaptatif** (4 côtés) + **ruban par côté** (lanes parallèles).
- **Rendu néon** (halo + trait net), couleur **dérivée des kinds des 2 extrémités** (avec
  fallback neutre).
- **Impulsions** (Phase 2) : bouton **debug ⚡** sous le node sélectionné → impulsion vers
  un node **atteignable** aléatoire ; **comète** (queue longue + rémanence) le long du
  chemin ; node **traversé** = halo doux, **cible** = flash fort bref, **notification/attente**
  = halo **persistant**.
- **Géométrie isolée et testable** (module pur, sans DOM, façon `collision.js`).

**Non-objectifs (YAGNI)**
- **Pas de wires arbitraires dessinés à la main** : topologie = **arbre `source_id`**.
- **Pas de `CanvasState.edges` typé** : on ne persiste pas de liste d'edges (D1).
- **Pas de vraie source chat** maintenant (node `chat` inexistant) : impulsion **simulée**
  via le bouton debug (§7).
- **Pas de couplage avec l'anti-collision** (autre spec `IDEAS.md`, non implémentée) — §10.
- Backend : **un champ ajouté** (`source_id`) + son câblage + une passe de réconciliation ;
  aucune logique de routage/animation serveur (`backend/` n'importe jamais `frontend/`).

## 3. Décisions

| # | Décision | Choix retenu |
|---|----------|--------------|
| D1 | **Représentation** | **Dérivée d'un parent par node** : `Node.source_id`. Câbles = pour chaque node non-racine, un lien `(node ↔ parent)`. Pas d'`edges` persistés → **auto-nettoyage**, **zéro désync**. |
| D2 | **Hiérarchie** | `kernel` = racine (`source_id=None`). `fileexplorer.source_id = <id kernel>`. `fileeditor.source_id = <id explorer>`. 🛡️ Le `source_id` d'un node spawné est **dérivé côté serveur** (§4.2), pas envoyé par le client. |
| D3 | **Forme du tracé** | **Subway 45°** : par câble, des segments **axis-aligned** + **exactement une diagonale à 45° stricte**. 🛡️ Les segments droits sont de **longueur variable** (ils absorbent l'écart de lane) ; la diagonale = `min(|Δx|, |Δy|)` entre les **ancres** → **jamais de débordement**. Angles vifs (pas d'arrondi). |
| D4 | **Ancrage** | **Adaptatif** : chaque extrémité choisit son **côté** (droite/gauche/haut/bas) par **axe dominant entre centres**. Tie `|dx|==|dy|` → **horizontal** (déterministe). |
| D5 | **Ruban** | Les câbles incidents à un **même node** sur un **même côté** = lanes : **triées** par la position du voisin, espacées de `GAP_LANE`. 🛡️ Garantie réelle = **non-superposition au voisinage des nodes partagés** (pas sur toute la longueur) ; croisement ponctuel toléré. |
| D6 | **Couleur** | 🛡️ Fonction pure `cableClass(kindChild, kindParent)` → classe CSS : violet `.k2e` (kernel↔explorer), teal `.e2e` (explorer↔editor), **fallback neutre `.cable-default`** pour toute autre paire (futur chat↔editor, §7) **ou parent introuvable**. |
| D7 | **Rendu** | Layer **`<svg class="cables">` unique dans `.world`**, **`z-index:-1`** 🛡️ (sous tout `.node-wrap`, y compris les z-index résiduels de `selectNode`), `pointer-events:none`, tracés en **coords monde**. **DOM impératif** (pas Alpine `x-for`) — leçon `05-canvas.md`. 🛡️ Échelle : le `scale()` de `.world` s'applique au SVG → **trait & comète scalés avec le zoom** (cohérent avec le reste du contenu monde) ; **assumé**, pas de `non-scaling-stroke`. |
| D8 | **Re-route** | Recalcul **impératif** (`drawCables()`) à : `init`, `onMove` (drag move/resize), `finish`, spawn, fermeture. 🛡️ `drawCables` réutilise les boîtes **mises en cache au `mousedown`** (le seul node qui change est celui qu'on manipule) pour éviter un reflow `offsetWidth` par frame. |
| D9 | **Source des boîtes** | Lue depuis le **DOM** : `x/y`=`style.left/top`, `w/h` explicites sinon `offsetWidth/offsetHeight` (coords monde, cf. `canvas.js` l.93-96). `source_id` exposé en `wrap.dataset.source` (posé par `renderNode`). 🛡️ Invariant : **tout `.node-wrap` porte `dataset.source`** ; `drawCables` traite un wrap sans `dataset.source` comme racine (pas de crash). |
| D10 | **Impulsion** | **Mini-toolbar** sous le node sélectionné, **un bouton ⚡**. Clic → cible **aléatoire parmi les nodes ATTEIGNABLES** 🛡️. **Chemin** = `pathBetween` sur l'arbre `source_id`, renvoyant des câbles **orientés** (sens du flux) 🛡️. **Comète** le long du chemin (`requestAnimationFrame` + easing), **Promise résolue à l'arrivée** de chaque segment. |
| D11 | **Glows** | Traversé = halo **doux** bref ; cible = **flash fort** (~1,5 s) puis fondu ; notification/attente = halo **persistant** (clignote) jusqu'à « Éteindre » (case debug). 🛡️ **Verrou** : un clic ⚡ est **ignoré** tant qu'une impulsion est en vol. Timers par node dans une **Map** (annulés/réarmés, jamais anonymes). Nettoyage des glows à `closeEditor`/`rerenderNode`. |
| D12 | **Tests** | `node --test` (géométrie pure, `cables.test.js`) ; `pytest` (câblage + migration `source_id`) ; **Playwright** (navigateur, screenshot + console), **à chaque phase**. |
| D13 | **Migration** | 🛡️ Fonction **`reconcile_source_links(state)`** distincte de `reconcile_constraints` : repère kernel/explorer **par kind dans `state.nodes`** ; repose les liens **absents OU cassés (dangling)** des built-in (explorer→kernel ; éditeur orphelin→explorer). Idempotente. Orchestration §4.2. |
| D14 | **Constantes** | 🛡️ Nommées et chiffrées dans `cables.js`, importées par les tests : `STUB` (sortie ⟂, ≈18 px monde), `GAP_LANE` (espacement de lane, ≈12 px monde) **clampé** : `gap = min(GAP_LANE, (longueurCôté − 2·MARGE)/(n−1))` quand `n>1` ; `MARGE` (≈10 px), `HIDE_DIST` (seuil sous lequel un câble entre boîtes quasi-confondues est masqué). |

## 4. Architecture

### 4.1 Modèle de données (backend)

`backend/models.py` — `Node` gagne **un champ** :

```python
class Node(BaseModel):
    ...
    source_id: str | None = None  # parent logique (câble dérivé). None = racine (kernel).
```

`CanvasState.edges` reste réservé/vide (commentaire l.45-46 mis à jour : « edges dérivés de
`source_id` »).

### 4.2 Câblage backend 🛡️

**Parent canonique par kind** — un helper unique, source de vérité partagée par le spawn et
la migration :

```python
# registry.py  — parent logique attendu d'un kind, par kind du parent.
CANONICAL_PARENT_KIND = {"fileexplorer": "kernel", "fileeditor": "fileexplorer"}

def canonical_parent_id(state, kind):
    pk = CANONICAL_PARENT_KIND.get(kind)
    return next((n.id for n in state.nodes if n.kind == pk), None) if pk else None
```

- `default_canvas()` : kernel puis explorer avec `source_id = kernel.id` (un seul appel,
  ids cohérents) :
  ```python
  k = kernel.build_kernel_node()
  e = file_explorer.build_file_explorer_node(); e.source_id = k.id
  return CanvasState(nodes=[k, e])
  ```
- 🛡️ **`create_node`** (route) **dérive** `source_id` côté serveur — le client n'a **rien**
  à envoyer (supprime toute dépendance à l'ordre `create`→`open`) :
  ```python
  node = build_node(body.kind, x=body.x, y=body.y)
  node.source_id = (body.source_id if body.source_id and any(n.id == body.source_id for n in state.nodes)
                    else canonical_parent_id(state, body.kind))
  ```
  `NodeCreate` gagne `source_id: str | None = None` (override **optionnel**, futur).
- 🛡️ **`reconcile_source_links(state)`** (registry.py) — n'utilise **pas** `builder()`, ne
  saute **pas** les kinds inconnus :
  ```python
  for n in state.nodes:
      if n.kind == "kernel":
          n.source_id = None
      elif n.source_id is None or not any(o.id == n.source_id for o in state.nodes):  # absent OU dangling
          n.source_id = canonical_parent_id(state, n.kind)
  ```
  Idempotente ; ne touche pas un `source_id` valide existant.
- 🛡️ **Orchestration** (cartographie explicite des 3 fonctions de `bootstrap.py`) :
  - `load_canvas` : `model_validate` → `reconcile_constraints` → **`reconcile_source_links`** → return.
  - `_ensure_builtin_nodes` : `load_canvas` → `extend(missing)` (built-in réinjectés avec
    des **UUID neufs**) → **rappeler `reconcile_source_links(state)`** *avant* `save` (sinon
    un explorer hérité pointe vers un ancien kernel id → dangling).

> Les fabriques `build_*` restent inchangées : `source_id` est posé par la route / la
> réconciliation, pas par la fabrique (qui ne connaît pas le graphe).

### 4.3 Module de géométrie pur — `frontend/static/js/cables.js`

**Script classique** (pas ESM), inclus **avant** `canvas.js` (comme `collision.js`). Expose :

```js
const MekiCables = {
  STUB, GAP_LANE, MARGE, HIDE_DIST,                 // 🛡️ constantes nommées (D14)
  adaptiveSide, sideAnchor, assignLanes,
  subwayPoints, pointsToPath, cableClass, pathBetween,
};
if (typeof module !== 'undefined' && module.exports) module.exports = MekiCables; // node --test
if (typeof window !== 'undefined') window.MekiCables = MekiCables;                 // navigateur
```

Fonctions **pures** (boîtes `{id, x, y, w, h, source}` ; centres dérivés) :

| Fonction | Rôle |
|----------|------|
| `adaptiveSide(a, b)` | Côté de sortie de `a` vers `b` par axe dominant des centres ; tie → `'right'`/`'left'`. `adaptiveSide(b,a)` = côté de l'autre bout. |
| `sideAnchor(box, side, off)` | Point d'ancrage sur un côté, décalé de `off` le long de la tangente. 🛡️ `off` **clampé** à `[−L/2+MARGE, +L/2−MARGE]` (L = longueur du côté) → l'ancre reste sur la face. |
| `assignLanes(cablesOnSide)` | Pour un `(node, side)` : **trie** par position du voisin, attribue des offsets centrés `(i−(n−1)/2)·gap`, `gap` = `min(GAP_LANE, (L−2·MARGE)/(n−1))` 🛡️. |
| `subwayPoints(anchorA, sideA, anchorB, sideB)` | 🛡️ **Prend les ancres déjà décalées** (lanes incluses). Stub ⟂ `STUB` depuis chaque ancre, puis **connecteur** : segment droit + **diagonale 45° stricte de longueur `min(|Δx|,|Δy|)` entre les stubs** + segment droit. Oriente la diagonale selon `min(adx,ady)` des **stubs** (indépendant du côté) → **pas de débordement** (D3). |
| `pointsToPath(points)` | `points[]` → `'M … L …'` — **uniquement** des commandes `M`/`L` (angles vifs, garde D3). |
| `cableClass(kindChild, kindParent)` | 🛡️ → `'k2e'` / `'e2e'` / `'cable-default'` (fallback). |
| `pathBetween(nodesById, fromId, toId)` | 🛡️ **Liste ordonnée et ORIENTÉE** de câbles `{childId, parentId, dir}` (`dir`='up' enfant→parent, 'down' parent→enfant) du chemin réel `from→to` (montée vers l'ancêtre commun puis descente). `from==to` → `[]`. **Composantes disjointes / pas d'ancêtre commun → `null`** (≠ `[]`). **Garde anti-cycle** : set d'ids visités → `null` si cycle. |

> La géométrie exacte est **figée par les tests** (§9). La spec fixe l'intention et les
> invariants (45° strict sur l'unique diagonale, lanes parallèles non superposées près des
> hubs, chemin d'arbre orienté correct).

### 4.4 Rendu & re-route (DOM impératif) — dans `canvas.js`

- 🛡️ **`ensureCablesLayer()`** idempotente : retourne `world.querySelector('svg.cables')`
  s'il existe, sinon crée le `<svg class="cables">` et l'insère **en premier enfant** de
  `.world`. Appelée en tête de `drawCables()` et dans `init` **avant** `renderNodes`. CSS :
  `.cables{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:-1}`.
- 🛡️ `renderNodes` (l.45-48) ne doit **pas** effacer le SVG : remplacer uniquement les
  `.node-wrap` (ou ré-insérer le SVG en premier enfant après). `rerenderNode`/`saveSettings`
  (l.233-238) opèrent sur le `.node-wrap` (pas sur `.world`) → n'altèrent pas le SVG, mais
  **préservent `wrap.dataset.source`** (ne recréent pas le wrap).
- `renderNode` (l.50-63) pose `wrap.dataset.source = node.source_id || ''`.
- **`drawCables()`** : `ensureCablesLayer()` → lit toutes les `.node-wrap` → Map `id→{box,kind}`
  (une passe) → pour chaque wrap avec `dataset.source` **présent dans la Map** (sinon câble
  ignoré, D9/§8) : déduit les deux côtés (`adaptiveSide`) → groupe par `(node, side)` →
  `assignLanes` → `sideAnchor` (ancres décalées) → `subwayPoints` → `pointsToPath` →
  `cableClass(kindChild, kindParent)` 🛡️ (kind parent via la Map) → met à jour
  **impérativement** un `<g data-edge="<childId>">` (halo + net) par câble ; supprime les `<g>`
  dont le câble a disparu.
- **Re-route (D8)** : `drawCables()` dans `init` (après `renderNodes`), `onMove` (après
  `applyBox`, l.117), `finish`, après le spawn (`world.appendChild`, l.385), et dans
  `closeEditor` **uniquement après le `wrap.remove()` réussi** (l.347, pas avant les early
  returns) 🛡️. Pendant un drag, les boîtes des **autres** nodes sont prises au `mousedown`
  (cache) ; seule la box du node manipulé est relue 🛡️.

### 4.5 Impulsions (Phase 2) — `canvas.js` + `cables.js`

- 🛡️ **Mini-toolbar** : élément **frère du `.node-wrap`** dans `.world` (pas enfant, pour
  survivre à `rerenderNode`), positionné en coords monde **sous** la box du node sélectionné,
  recréé à chaque `selectNode`, retiré à la désélection. Contient **un bouton ⚡**. Vaut
  **aussi pour le kernel** (sélectionnable malgré `movable:false`).
- **Déclenchement** : clic ⚡ → calcule l'**ensemble atteignable** depuis le node → tire une
  cible **au hasard parmi lui** (si vide → no-op) → `pathBetween` → anime la **comète** le
  long des `<g data-edge>` du chemin, **dans le sens `dir`** de chaque segment 🛡️
  (`getPointAtLength` 0→len si on parcourt dans le sens où le `<path>` est tracé, len→0 sinon ;
  convention de tracé figée par test). Promise par segment, enchaînées.
- 🛡️ **Comète** = élément(s) **dans le `<svg class="cables">`** (donc coords monde, scale
  hérité). Rayon/queue en unités monde (scalés par le zoom — assumé, D7).
- **Glows (D11)** : `.glow-soft` (traversé, bref) / `.glow-strong` (cible, ~1,5 s puis fondu) /
  `.glow-notif` (persistant, clignote). 🛡️ Verrou « impulsion en vol » ; **Map nodeId→timeoutId**
  (annulés/réarmés) ; extinction de `.glow-notif` via la case debug « Éteindre » ; une 2ᵉ notif
  sur un node déjà notif **réarme** (pas d'empilement) ; `closeEditor`/`rerenderNode` nettoient
  les glows et timers du node concerné.

## 5. Comportements détaillés

### 5.1 Création / spawn
`openFileInNewEditor` (l.351-389) POSTe `{kind:'fileeditor', x, y}` ; 🛡️ le serveur
**dérive** `source_id = <id explorer>` (§4.2). Après `world.appendChild(renderNode(node))`
(l.385) — `renderNode` pose `dataset.source` depuis la réponse — `drawCables()` fait
apparaître le câble éditeur→explorer.

### 5.2 Déplacement / redimensionnement
`onMove` (l.107-118) → `applyBox` → `drawCables()`. 🛡️ L'ancrage **adaptatif** peut **changer
de côté** non seulement au **déplacement** mais aussi au **redimensionnement** (le centre se
déplace quand `w/h` changent : agrandir un éditeur jusqu'à englober l'explorer). Bascule
volontairement **nette** (acceptée). Au lâcher (`finish`) → `drawCables()` (le POST
`persistNode`, inchangé, ne touche pas les câbles dérivés).

### 5.3 Suppression / fermeture
`closeEditor` : DELETE serveur d'abord ; **si échec → early return** sans retirer le wrap
(l.341) ; sinon `wrap.remove()` (l.347) **puis** `drawCables()` 🛡️ → le câble disparaît
(node source absent). 🛡️ Si le node fermé est `selectedId` → `selectedId=null` + retrait de
la mini-toolbar.

### 5.4 Chargement / migration (D13)
`init` après `renderNodes` → `ensureCablesLayer()` + `drawCables()`. Backend : la
réconciliation `reconcile_source_links` (orchestration §4.2) repose les liens absents/cassés
des built-in ; persisté à la prochaine sauvegarde.

## 6. Persistance
- `source_id` est un champ `Node` → **persisté** dans `canvas.json` (Pydantic, roundtrip
  `model_dump`/`model_validate`).
- **Aucun** nouvel endpoint : `POST /api/canvas/nodes` (spawn, `source_id` dérivé serveur),
  `DELETE`, `POST /api/canvas/nodes/{id}` (move/resize, inchangé). Câbles jamais persistés.

## 7. Le bouton debug & la vraie source (futur)
Le ⚡ **simule** l'impulsion tant que le node `chat` n'existe pas. À l'arrivée du chat,
l'impulsion réelle partira du chat vers l'éditeur du fichier modifié (`AgentEnd`,
`05-canvas.md`) **sans changer** rendu ni pathfinding : il suffira que l'éditeur ait
`source_id = <chat>`. 🛡️ `cableClass` aura alors une paire `chat↔editor` à mapper (sinon
fallback neutre) ; et si le chat devient **supprimable**, `delete_node` devra **ré-attacher**
ses enfants (au grand-parent) ou les nuller (aujourd'hui inutile : éditeurs = feuilles,
explorer built-in non supprimable).

## 8. Cas limites & risques
- 🛡️ **45° vs run disponible** : résolu par construction — la diagonale = `min(|Δx|,|Δy|)`
  entre stubs, le reste en segments droits → **jamais** de débordement ni d'angle non-45°
  sur la diagonale (D3).
- 🛡️ **Boîtes incluses / centres quasi-confondus** (atteignable dès la cascade +28 px,
  `editorPosAt` l.399 ; ou resize englobant) : `adaptiveSide(a,b)` et `adaptiveSide(b,a)`
  peuvent désigner le **même côté** → tracé dégénéré. Règle : si distance centre-à-centre
  `< HIDE_DIST` → **câble masqué** ; sinon si `sideA==sideB` → `subwayPoints` fait un **U-route**
  (sortie ⟂ puis demi-tour). Couvert par test.
- 🛡️ **Bascule de côté** (move **et** resize) : nette, attendue ; re-lane des deux côtés
  concernés à la frame de bascule.
- 🛡️ **`source_id` orphelin** (parent absent) → câble **ignoré** au rendu (pas de crash).
- 🛡️ **Cycle** dans `source_id` → `pathBetween` borne par **set d'ids visités**, renvoie
  `null`. (Le serveur ne garantit pas formellement l'acyclicité — la dérivation canonique +
  la garde JS sont les vraies sécurités.)
- 🛡️ **Cible injoignable** (node isolé / composantes disjointes) : la cible est tirée parmi
  l'**ensemble atteignable** ; `pathBetween` renvoie `null` si pas de chemin ; ⚡ **no-op**.
- 🛡️ **Empilement** : `.cables{z-index:-1}` garantit le câble **derrière** chaque carte, y
  compris les z-index résiduels que `selectNode` laisse (jamais remis à zéro).
- 🛡️ **Zoom** : trait/halo/comète scalés avec le zoom (assumé). Captures Playwright aux zooms
  extrêmes (0,2 / 4).
- 🛡️ **SVG `overflow:visible`** + node à **coordonnées négatives** : à **tester en
  navigateur** (ne pas présumer le comportement du root SVG identique à un `<div>`).
- **Kernel auto-dimensionné** : `w/h` via `offsetWidth/Height` (header **synchrone**), stable
  au 1er rendu (cohérent `canvas.js` l.93-96).
- **Alpine vs SVG par frame** : manipulation **impérative** (pas `x-for`), D7.

## 9. Stratégie de test (D12)

**Géométrie pure (`node --test`, zéro dep)** — `frontend/static/js/cables.test.js`
(importe les constantes D14) :
- `adaptiveSide` : 4 côtés selon dx/dy ; tie `|dx|==|dy|`→horizontal ; symétrie ; **boîtes
  incluses** (même côté détecté).
- `sideAnchor` : point/tangente corrects ; 🛡️ offset **clampé** sur la face (n lanes sur un
  côté court restent toutes sur le node).
- `assignLanes` : tri par voisin ; offsets centrés ; `gap` adaptatif ; **2 câbles d'un même
  `(node,côté)` ne partagent jamais la même lane**.
- `subwayPoints` : **une seule diagonale à 45° stricte** (`|Δx|==|Δy|` sur ce segment),
  reste axis-aligned ; stubs ⟂ ; cas H-dominant, V-dominant, **run court** (Δy≫Δx), **U-route**
  (`sideA==sideB`).
- `pointsToPath` : 🛡️ sortie `M…L…` **exacte**, **aucune** commande `C/Q/A`, `segments == points−1`.
- `cableClass` : 🛡️ paires connues + **fallback** (paire inconnue, parent introuvable).
- `pathBetween` : 🛡️ `from==to`→`[]` ; parent↔enfant (1 câble, **sens** vérifié) ; **montée
  pure** feuille→kernel (LCA==to) ; **descente pure** kernel→feuille (LCA==from) ; frère↔frère
  (LCA interne, sens up puis down) ; **composantes disjointes → `null`** ; **cycle → `null`**.

**Backend (pytest)** — `tests/unit/test_nodes.py` / `test_app.py` :
- `default_canvas()` : `kernel.source_id is None` ; `explorer.source_id == kernel.id`.
- `create_node` : `fileeditor` → `source_id` **dérivé** = id explorer (sans l'envoyer) ;
  override `source_id` valide respecté ; override bidon → dérivé/`None` (pas de 422).
- 🛡️ **Roundtrip** `model_dump`/`model_validate` avec `source_id` **non nul**.
- 🛡️ **Chaîne réelle** : POST `/nodes` (fileeditor) puis POST `/{id}/open` → la réponse
  `/open` conserve `source_id` ; `GET /api/canvas` le restitue.
- 🛡️ **Migration** `reconcile_source_links` : `source_id` absent → reposé ; **dangling** →
  re-pointé ; **idempotent** (2ᵉ passe inerte) ; kind inconnu **non sauté**.
- 🛡️ **`_ensure_builtin_nodes`** : canvas `{explorer seul}` / `{kernel seul}` →
  après ensure+load, `source_id` référence un node **existant** (pas l'ancien id) ; ids
  built-in **stables** sur deux boots.

**Comportement (Playwright / navigateur, screenshot + console)** :
- *Phase 1* : N câbles rendus (= nodes à `source` valide), **0 erreur console** ; **1 seul**
  `svg.cables` après 5 `drawCables` (premier enfant) ; node **jamais recouvert** par un câble
  (sélection/désélection de 3 nodes) ; drag → `d` du `<path>` **change** ; node traîné de
  l'autre côté du hub / **resize englobant** → câble **change de côté** ; ≥2 éditeurs d'un côté
  → lanes **parallèles non superposées** près du hub ; après `saveSettings` de l'explorer, les
  câbles **persistent** ; node à coordonnées **négatives** visible ; zooms **0,2 / 4** ; FPS
  correct avec **3 éditeurs** ouverts ; capture.
- *Phase 2* : sélection (y compris **kernel**) → **⚡ apparaît** sous le node ; clic → comète
  le long du chemin **sans reculer** (descente) ; node traversé **doux**, cible **flash** ;
  **notification** persistante + « Éteindre » ; 2ᵉ clic **ignoré** pendant un vol ; **0 erreur
  console** ; capture.

> Rappel mémoire projet : valider le front avec **Playwright (screenshot + console)** avant
> de dire « ça marche » — un HTTP 200 ne prouve pas l'exécution JS.

## 10. Fichiers touchés
- **+** `frontend/static/js/cables.js` — géométrie pure + constantes (`window.MekiCables` +
  `module.exports`), **script classique**.
- **+** `frontend/static/js/cables.test.js` — tests `node --test`.
- `backend/models.py` — `Node.source_id` (+ MAJ commentaire `edges`).
- `backend/nodes/registry.py` — `CANONICAL_PARENT_KIND`/`canonical_parent_id`, `default_canvas()`
  (lien explorer→kernel), **`reconcile_source_links`** 🛡️.
- 🛡️ `backend/bootstrap.py` — appeler `reconcile_source_links` dans `load_canvas` (après
  `reconcile_constraints`) **et** dans `_ensure_builtin_nodes` (après `extend(missing)`, avant
  `save`).
- `frontend/routes/canvas.py` — `NodeCreate.source_id` (override optionnel) + dérivation
  serveur dans `create_node`.
- `frontend/static/js/canvas.js` — `wrap.dataset.source`, `ensureCablesLayer()`, `drawCables()`
  + hooks re-route (init/move/resize/spawn/close), cache des boîtes au `mousedown`, *(Phase 2)*
  mini-toolbar ⚡ + comète + glows + sélection-cleanup.
- `frontend/static/css/canvas.css` — `.cables` (z-index:-1, pointer-events, overflow), néon
  (`.cable-halo`/`.cable-core`, classes `.k2e`/`.e2e`/`.cable-default`), halos de glow, mini-toolbar.
- `frontend/templates/canvas.html` — `<script defer src="/static/js/cables.js">` **avant**
  `canvas.js` (l.11).
- `tests/unit/test_nodes.py` / `test_app.py` — câblage `source_id`, chaîne create+open,
  migration, `_ensure_builtin_nodes`.
- 🛡️ **Coexistence anti-collision** : les deux specs modifient `onMove`/`init`/spawn de
  `canvas.js` à des **points distincts** (collision = positions ; câbles = `drawCables()`). À
  merger sans conflit ; aucune dépendance.

## 11. Découpage en 2 phases (entrée du plan)

**Phase 1 — Câbles** (puis **checkpoint vérif manuelle**) :
1. **Modèle + backend** : `Node.source_id` ; `canonical_parent_id` ; `default_canvas`
   (explorer→kernel) ; `reconcile_source_links` + orchestration `bootstrap` ;
   `create_node` dérive `source_id`. Tests pytest (roundtrip, chaîne create+open, migration,
   `_ensure_builtin_nodes`).
2. **Géométrie pure** : `cables.js` + `cables.test.js` (constantes, `adaptiveSide`,
   `sideAnchor` clampé, `assignLanes`, `subwayPoints` 45°+U-route, `pointsToPath`, `cableClass`).
3. **Rendu** : `ensureCablesLayer` (z-index:-1, premier enfant, idempotent), `dataset.source`,
   `drawCables` (néon, couleur via `cableClass`), include `cables.js` dans le template,
   `renderNodes` préserve le SVG.
4. **Re-route** : hooks init/move/resize/spawn/close ; cache des boîtes au `mousedown`.
5. **Validation navigateur** (Playwright + captures, zooms, coords négatives) → **checkpoint**.

**Phase 2 — Impulsions** (puis vérif manuelle finale) :
6. **Pathfinding** : `pathBetween` orienté (+ tests : sens, disjoint→null, cycle→null,
   montée/descente pures).
7. **Mini-toolbar ⚡** (frère du wrap, recréée/retirée à la (dé)sélection, kernel inclus).
8. **Comète** : `requestAnimationFrame` le long du chemin, sens par segment, Promise à l'arrivée,
   comète dans le SVG.
9. **Glows** : doux/flash/notif + **verrou** d'impulsion + Map de timers + nettoyage à
   close/rerender.
10. **Validation navigateur** (Playwright + captures).

Chaque étape : test (rouge) → implémentation (vert) → commit, comme le Jalon 1.

## 12. Raffinements de routage (post-Phase 1, validés en navigateur)

Demandé après la livraison Phase 1. **Pur 45°** : pas de coin à 90° en plein câble (rejeté
par l'utilisateur). Géométrie **pure** dans `cables.js` (testée `node --test`), branchée dans
`drawCablesFrom`.

- **D15 — Contournement d'obstacles (pur 45°)** : un câble ne doit pas passer **sous** un node
  tiers. Deux étages, par ordre de préférence :
  1. **« up-and-over » 45°** sur la face naturelle — `routeAround(...)` : si le tracé direct
     traverse une boîte (`segHitsBox`/`pathHits`, Liang-Barsky), router au-dessus/en dessous de
     l'union des obstacles touchés, à 45° (cas vertical par réflexion x↔y). `obstacles` = boîtes
     des autres nodes **sauf les 2 extrémités**, gonflées de `STUB`.
  2. **Changement de face** — si aucun couloir 45° ne dégage sur la face naturelle,
     `routeAvoiding(srcBox, baseSrc, tgtBox, baseTgt, obstacles)` essaie les **autres faces**
     (haut/bas/…) de la node concernée et garde le tracé **45° le plus court** qui dégage
     (petite pénalité par face changée ; `route45OrNull` renvoie null si une face ne passe pas).
     Effet : la node « la plus proche » de l'obstacle voit sa **face de sortie/entrée changer**,
     contournement naturel sans coin 90°. Conserve l'invariant segments **H/V/45°**.

  Branchement `drawCablesFrom` : 4a tracé via `routeAround` (avec les lanes du ruban) ; 4b
  **escape** = si `pathHits` encore vrai → `routeAvoiding` (offset 0). **Repli** (`hit:true`,
  câble droit) seulement si **aucune face** ne dégage — ce qui n'arrive que si un node
  **chevauche** une extrémité (cf. dépendance ci-dessous).

- **D16 — Anti-superposition des CÂBLES : DIFFÉRÉE.** Les fonctions pures restent dans
  `cables.js` (`diagOf`/`diagsOverlap`/`segBBox`/`bboxesOverlap`, testées) mais **ne sont pas
  branchées** (la passe de bump écrasait le changement de face). À reprendre plus tard.

- **D17 — Dépendance à l'anti-chevauchement des nodes** : le contournement est limité par un
  fait géométrique — **on ne peut pas faire sortir un câble d'une node pour éviter un obstacle
  posé sur cette même node**. Tant que des nodes peuvent se **chevaucher**, certains
  câbles n'ont aucune face dégageante → repli droit (sous le node). Le « zéro recouvrement »
  est donc un **prérequis** pour des câbles toujours propres. C'est l'objet de la spec sœur
  [`2026-05-29-canvas-node-collision-design.md`](2026-05-29-canvas-node-collision-design.md)
  (anti-chevauchement & collision douce), à implémenter ensuite.

Validé honnêtement (Playwright) : sur disposition **dense réelle** sans chevauchement de
nodes → **0 câble sous un node**, contournement appliqué (câble à 7 segments, face changée),
0 erreur console ; `node --test` **17/17**. Le seul résidu observé venait de **deux éditeurs
qui se chevauchaient** (→ D17).
