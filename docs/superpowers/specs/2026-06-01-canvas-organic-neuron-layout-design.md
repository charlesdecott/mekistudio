# Disposition organique « neurones » du canvas (design)

> Statut : validé en brainstorm (companion visuel, maquettes interactives) le 2026-06-01.
> Remplace la 1ʳᵉ tentative (arbre « tidy » vertical, `tree-layout.js`) **rejetée** :
> trop haute, oblige à scroller, doublons, pas la vision. Cf. mémoire
> `canvas-layout-organic-neuron-vision`.
>
> **MISE À JOUR (2026-06-02)** : le re-layout organique GLOBAL décrit ci-dessous (relaxation
> de tout le sous-arbre à chaque spawn) a été remplacé par un **placement INCRÉMENTAL** suite au
> retour utilisateur (« à chaque spawn il ne faut pas recalculer toutes les positions, sinon ça
> clignote »). On garde la **direction** (croissance vers l'extérieur depuis l'explorateur, dendrite)
> et l'**anti-collision**, mais chaque node est posé **une seule fois** dans un trou libre
> (`editorSpawnPos`) et les nodes existants **ne bougent plus jamais**. `neuro-layout.js` (relaxation
> globale) a été supprimé. Le reste de la vision (explorateur centré, comète qui matérialise les
> dossiers, auto-fit) est conservé.

## But

Disposer les nodes **fichier/dossier créés par les impulsions** de façon **organique et
directionnelle** (« comme les neurones d'un cerveau »), pas en colonne/ligne/grille :

- **Explorateur au CENTRE**, qui connecte les fichiers de la racine.
- Chaque dossier part dans une **direction** depuis le centre ; à chaque niveau on
  **tourne** (gauche/droite) → **dendrites** qui serpentent vers l'extérieur
  (ex. `x/y/z.md` : `x` part dans une direction, `y` tourne, `z` continue).
- **Tout tient à l'écran** (auto-zoom du viewport, pas de scroll).
- **Câbles inchangés** : subway 45° + ruban (MekiCables), style néon.
- Les **dossiers sont matérialisés par l'impulsion** (la comète les construit) comme
  les fichiers ; **zéro doublon**.

## Paramètres validés (réglés en direct dans le companion)

| Param | Valeur | Rôle |
|---|---|---|
| `chaos` | **0.25** rad | amplitude du virage à chaque niveau (petit = doux) |
| `length` | **180** px | longueur de base d'un segment parent→enfant |
| `spread` | **1.0** rad | écart angulaire entre frères (large = bien éclaté) |

Déterministe : la « graine » de variation est dérivée de l'**id/chemin** du node →
même arbre = même forme (stable au reload, pas de sautillement aléatoire).

## Architecture

### Module pur `neuro-layout.js` (`window.MekiNeuroLayout`, testé `node --test`)

`layout(items, rootId, opts) -> { id: {x, y} }` (coin haut-gauche). Pur, sans DOM —
même esprit que `cables.js`/`collision.js`. Remplace `tree-layout.js`.

- `items` : `[{ id, parent, w, h, sortKey }]` ; `rootId` = l'explorateur (fixe au centre).
- `opts` : `{ rootX, rootY, chaos, length, spread, seed, gap }`.
- **Placement directionnel** (récursif, déterministe par hash de l'id) :
  - racine au centre ; enfants directs répartis **tout autour** (angle de base réparti
    sur 2π + gigue) ;
  - `place(node, dir, depth)` : position = parent + `dir·length·(0.78 + var)` ; chaque
    enfant continue dans `dir + spread·(rang−centre) + ±chaos·var` (virage + éventail).
- **Anti-collision** : relaxation itérative qui **sépare les boîtes qui se recouvrent**
  (racine figée), bornée, jusqu'à zéro recouvrement — réutilise l'esprit `MekiCollision`.
- Renvoie des positions **sans chevauchement**.

### `canvas.js`

- `layoutFolderTree()` (renommé conceptuellement « disposition organique ») construit
  les `items` depuis le DOM (folders + éditeurs du sous-arbre de l'explorateur), appelle
  `MekiNeuroLayout.layout` avec `chaos:0.25, length:180, spread:1.0`, applique les
  positions (persistées), **garde anti-drag** conservée.
- **`fitView()`** : après une disposition, **ajuste le viewport** (pan + zoom) pour que
  **tous les nodes tiennent à l'écran** (avec marge). Déclenché après chaque impulsion-
  spawn (transition douce). Ne ré-ajuste que si un node sort de la vue (évite le
  « respire » permanent).
- **Suppression de `tree-layout.js`** (disposition verticale rejetée).

### Comète qui matérialise les dossiers (et les fichiers)

À l'auto-spawn d'un fichier lu : tous les **nouveaux nodes** de la branche (dossiers créés
+ éditeur) sont marqués `spawning` (invisibles), leurs câbles entrants cachés ; la **comète
parcourt tout le chemin** chat→…→dossier→…→éditeur et, en arrivant sur chaque nouveau node,
le **révèle** (fade-in + glow) en **traçant son câble** progressivement. Les dossiers
naissent donc **le long de l'impulsion**, comme les fichiers (plus de dossiers « surgis » à
part). `pulseTo`/`animateComet` étendus pour révéler N nodes / tracer N segments neufs.

### Zéro doublon

Création de dossier **idempotente** (find-or-create par chemin, garde `_creatingFolders` +
`_hasFolderNode` déjà en place) ; la passe de disposition ne crée jamais de node ; on
vérifie en Playwright que `#folders == #dossiers attendus` (pas de doublon).

## Tests

- **`node --test`** : `neuro-layout.js` — racine centrée, enfants tout autour, virage par
  niveau, déterminisme (même entrée → mêmes positions), **zéro recouvrement** après
  relaxation, ignore les nodes hors sous-arbre.
- **Playwright** : ouvrir une arborescence (chaînes + bifurcations) →
  - **0 chevauchement** de nodes, **0 câble sous une node** (subway+ruban),
  - **tout tient dans le viewport** après fit,
  - la **comète matérialise les dossiers** (nouveaux folders `spawning`→révélés),
  - **0 doublon** de dossier, **0 erreur console**.

## Hors périmètre

- Le placement reste **au spawn / changement de structure** (pas de simulation physique
  continue). Le déterministe + relaxation suffisent à l'effet « neurones » stable.
- L'utilisateur peut toujours déplacer un node ; il se re-disposera au prochain spawn.
