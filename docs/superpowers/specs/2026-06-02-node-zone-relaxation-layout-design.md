# Design — Modèle « node-zone » à relaxation

> Date : 2026-06-02 · Statut : validé en brainstorming, à relire avant plan d'implémentation.
> Périmètre : placement des nodes `folder`/`fileeditor` du canvas (brique G) et rendu de leurs câbles.

## Problème

Le placement actuel (incrémental « place-once », `editorSpawnPos`) produit, sur un repo réel, un canvas où **le backbone dossier→dossier se perd** :

- les dossiers sont packés serré → les câbles ambre inter-dossiers sont courts et se croisent ;
- le backbone (bleu `cab-d1` + ambre `cab-folder`) a la même épaisseur que la masse des câbles fichiers verts (`cab-file`), qui dominent visuellement ;
- le modèle « zone = fichiers seuls, la node dossier fait le pont dans le vide » rend le rattachement d'un dossier peu lisible.

Référence visuelle : `scripts/.pw/many-sequential.png` (cluster de droite, câbles verts entrelacés).

## Vision cible (modèle node-zone)

On **inverse** le modèle de zone : un dossier devient une **node-zone**.

- La tuile 📁 du dossier est posée **au centre** de sa zone.
- Ses **fichiers directs** s'arrangent **autour d'elle, dans la zone**.
- Les **zones ne se chevauchent jamais**.
- Les dossiers sont reliés entre eux par le **câble ambre** `cab-folder` (backbone), l'explorateur par le **câble bleu** `cab-d1`.
- Un dossier-enfant est sa **propre zone**, posée à côté (jamais à l'intérieur du parent) et reliée par un câble ambre.

Maquette de référence (validée) : `.superpowers/brainstorm/.../zone-node.html`.

## Décision structurante : croissance des zones

Une zone **grandit** quand de nouveaux fichiers arrivent, et finit par toucher une voisine.

**Décision retenue : re-arranger en douceur (relaxation).** Quand une zone grossit et menace une voisine, on **pousse doucement** les zones voisines (relaxation type ressorts) pour rétablir le vide, **animé** via la transition CSS existante (`left/top .28s`).

**Conséquence — changement d'invariant.** L'invariant actuel « les nodes existants ne bougent JAMAIS (pas de re-layout → pas de clignotement) » est **remplacé** par :

> Les zones **se ré-arrangent en douceur (animé)** à chaque changement, **ne se chevauchent jamais**, et le mouvement reste **lisse** (transition CSS, jamais de saut/clignotement).

À mettre à jour : `CLAUDE.md`, `docs/ARCHITECTURE.md`, et la mémoire `canvas-layout-organic-neuron-vision` / `dev-loop-and-canvas-staleness`.

## Architecture

Découpage en unités pures (testables `node --test`) + un câblage DOM impératif dans `canvas.js`, conformément à l'archi existante.

### 1. Géométrie de zone — inversion (`territories.js` + `folderBlobCorners`)

État actuel (`canvas.js:192` `folderBlobCorners`) : la zone d'un dossier = enveloppe de ses **fichiers directs uniquement** ; la tuile dossier est **exclue**.

Changement : la zone = enveloppe **{ coins de la tuile dossier } ∪ { coins de ses fichiers directs }**. La tuile est donc **dans** sa zone, au centre.

- `folderBlobCorners` : ajouter les coins de la tuile du dossier au groupe (en plus de ses fichiers).
- Rendu inchangé : `drawFolderTerritories` continue d'utiliser `roundedHullPath(pts, 22)` et la teinte `_folderHue`.
- `territories.js` reste pur ; pas d'API nouvelle nécessaire (le hull englobe juste un point de plus).

### 2. Moteur de placement — relaxation (`zonelayout.js`, nouveau, pur)

Remplace la logique incrémentale de `editorSpawnPos` pour les zones.

**Modèle.** Chaque dossier = un **disque-zone** :
- `center` = position de la tuile dossier ;
- `radius` = distance du centre au coin de membre le plus éloigné (tuile + fichiers) + marge `PAD`.

**Entrée du solveur :** liste de zones `{ id, parentId, center, radius, pinned }` (+ l'explorateur, `pinned:true`, comme racine).

**Forces, par itération (priorité décroissante) :**
1. **Répulsion (contrainte dure)** : pour toute paire de zones dont `dist(centres) < r₁ + r₂ + VIDE`, déplacer les deux centres le long de la ligne des centres pour rétablir l'écart `VIDE`. Les zones `pinned` ne bougent pas (toute la correction va sur l'autre).
2. **Ressort backbone (attraction)** : chaque zone-enfant est tirée vers son parent vers une **distance-repos** `rest = r_parent + r_child + GAP` → câble ambre court, hiérarchie compacte.
3. **Anti-dérive douce** : léger rappel pour éviter que l'ensemble parte à l'infini (optionnel, faible).

**Sortie :** nouveaux `center` par zone après `ITERS` (~80) itérations. Déterministe (aucun aléa) : l'initialisation d'une **nouvelle** zone se fait *vers l'extérieur depuis le parent, dans l'angle le plus libre* (on garde l'idée dendrite de l'actuel `editorSpawnPos`), puis le solveur relaxe.

**API pure proposée :**
```
MekiZoneLayout.solve(zones, { iters, VOID, GAP }) -> Map<id, {x, y}>
MekiZoneLayout.freestAngle(parentCenter, occupiedAngles) -> radians   // init d'une nouvelle zone
```

**Câblage (`canvas.js`).** À chaque ajout de fichier/dossier (ou reload) : construire les disques depuis le DOM (`nodeBoxes` + `folderBlobCorners`), appeler `solve`, écrire les nouveaux `home` des tuiles dossier → la transition CSS anime le déplacement. Les fichiers suivent (cf. §3).

### 3. Arrangement intra-zone (`zonelayout.js` ou `folders.js`, pur)

Les fichiers d'un dossier se packent en **anneaux concentriques autour de la tuile** :
- anneau le plus proche d'abord, remplissage angulaire régulier, croissance vers l'extérieur ;
- un fichier ne chevauche ni la tuile dossier ni un autre fichier ;
- positions **relatives au centre du dossier** → quand la zone bouge, les fichiers suivent par simple translation.

**API pure proposée :**
```
MekiZoneLayout.packAround(folderCenter, folderSize, fileSizes) -> [{x, y}]   // top-left de chaque fichier
```

### 4. Routage des câbles backbone (`cables.js`)

Les câbles ambre/bleus passent **dans le vide entre zones** :
- ajouter les blobs des **autres** zones comme **obstacles** au routage (réutilise `routeAround` + obstacles gonflés `PAD`, déjà en place dans `drawCablesFrom`) → un câble parent→enfant ne traverse pas une 3ᵉ zone ;
- le ruban anti-superposition (`RIBBON_GAP`, déjà là) sépare les câbles backbone parallèles ;
- les câbles fichiers verts (`cab-file`) restent **courts, dans leur zone** (tuile↔fichier) → ils n'encombrent plus le backbone.

### 5. Hiérarchie visuelle (CSS seul — `canvas.css`)

Faire ressortir le backbone même avant relaxation :
- `cab-d1` + `cab-folder` : `cable-core` plus épais (~4 px) et pleine opacité, dessinés au-dessus ;
- `cab-file` : trait plus fin (~1.6 px) et opacité réduite (~.5).

## Invariants (mis à jour)

- Une zone englobe sa tuile dossier (centre) + ses fichiers directs.
- **Aucune paire de zones ne se chevauche** (écart ≥ `VIDE` garanti par la répulsion).
- Le mouvement des nodes est **animé et lisse** (transition CSS), jamais un saut.
- `backend/` n'importe jamais `frontend/` ; géométrie/logique pures côté front (testées `node --test`), `canvas.js` câble en DOM impératif.

## Tests (TDD)

**Purs (`node --test`) :**
- `zonelayout.test.js` — après `solve` : aucune paire de disques ne se chevauche ; chaque enfant est à `rest ± ε` de son parent ; idempotence/déterminisme (mêmes entrées → mêmes sorties) ; les zones `pinned` ne bougent pas.
- `packAround` — les fichiers ne chevauchent ni la tuile ni un autre fichier ; croissance vers l'extérieur ; positions relatives stables.
- `territories.test.js` — le hull d'un dossier inclut désormais les coins de la tuile.

**Playwright (scénario réel, `scripts/_repro_many.mjs` adapté) :**
- **0 chevauchement de zones** (mesure blob, déjà implémentée dans le script) ;
- la **tuile dossier est dans sa zone** (et proche du centroïde) ;
- **aucun câble backbone ne traverse une zone tierce** ;
- 0 erreur console ; screenshot de contrôle.

## Hors périmètre (YAGNI)

- Pas de drag manuel repositionnant les zones de façon persistante (le solveur reste maître).
- Pas de zoom/sémantique de niveau de détail.
- Pas de nesting visuel (zone-enfant *dans* la zone-parent) : les enfants sont des zones voisines reliées par câble.
