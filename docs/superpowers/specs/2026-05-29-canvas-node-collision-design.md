# Spec — Anti-chevauchement & collision « douce » des nodes

> Date : 2026-05-29 · Statut : design validé (brainstorming) → à transformer en plan
> Origine : idée notée dans [`docs/IDEAS.md`](../../IDEAS.md) (« Canvas — anti-chevauchement »).
> Durci par une revue adversariale (3 relecteurs : géométrie, ancrage code, UX) —
> les corrections issues de cette revue sont intégrées et signalées par 🛡️.

## 1. Problème & vision

Sur le canvas, les nodes peuvent aujourd'hui **se chevaucher librement** : la
boucle de drag (`canvas.js` → `onNodeMouseDown`/`onMove`, ~l.74-121) écrit
`node.x/y` sans aucune détection de collision, et les éditeurs spawnent même
**volontairement en cascade** (`openFileInNewEditor` → `editorPosAt(slot)`,
décalage `bx + bw + 40 + slot*28`, ~l.351-400) — recouvrement partiel de 28 px.

On veut l'inverse : **deux nodes ne se recouvrent jamais**. Quand on déplace un
node et qu'un autre est sur le chemin, le node percuté **s'écarte du couloir**
(animation légère) pour laisser passer le node déplacé — esprit « banc de
poissons » qui s'ouvre puis se referme.

## 2. Objectifs / non-objectifs

**Objectifs**
- Invariant **zéro recouvrement** (avec un `GAP` de respiration) tenu en continu :
  au **déplacement**, au **redimensionnement**, au **spawn**, et une fois **au
  chargement**.
- Collision **douce et animée** (« légère »), pas un blocage sec.
- Logique de géométrie **isolée et testable** (module pur, sans DOM).

**Non-objectifs (YAGNI)**
- Pas de moteur physique continu (les nodes ne dérivent jamais d'eux-mêmes).
- Pas de **cascade** : la poussée ne se propage pas de proche en proche.
- Pas de **réutilisation/focus** d'un éditeur déjà ouvert sur le même fichier
  (double-clic = toujours un nouvel éditeur, comme aujourd'hui — voir D8).
- Pas de changement backend **obligatoire** (l'API de persistance existante suffit ;
  une éventuelle taille de kernel explicite est *optionnelle*, cf. §8).
- Les câbles/wires (autre idée d'`IDEAS.md`) sont **hors périmètre**.

## 3. Décisions (brainstorming + 🛡️ revue)

| # | Décision | Choix retenu |
|---|----------|--------------|
| D1 | Node percuté au **déplacement** | **Revient après passage** : il s'écarte le temps du passage puis **revient** à son *home*. **Exception** : si on lâche le node déplacé sur le *home* du percuté, le percuté est **décalé définitivement**. 🛡️ Garantie portée par une **passe finale unique** au lâcher (§5.1), pas par l'état transitoire « écarté ». |
| D2 | **Cascade** | **Non.** A ne pousse que les nodes qu'il touche directement ; aucun report en chaîne. Si **aucun** des deux côtés perpendiculaires n'est libre (ou si l'obstacle est le `kernel`), **A est bloqué** au contact. 🛡️ On essaie **les deux côtés** avant de bloquer (§4.2/§5.1) — ce qui réduit fortement les blocages près du centre. |
| D3 | **Redimensionnement** | **Pousse le voisin, il reste écarté** (taille permanente). Poussée **contrainte au quadrant de croissance** (bas-droite). Si bloqué (no-cascade) → **resize borné** au contact. |
| D4 | **Spawn** | Un nouveau node naît dans un **espace libre** (`findFreeSpot`), recherche serrée depuis l'ancre « à droite de l'explorateur » → éditeurs **groupés**, pas dispersés. Fin du cascade-overlap. |
| D5 | **Au chargement** | **Réconciliation au boot** : **une passe ordonnée déterministe** (figés d'abord, puis mobiles par `id`, ensemble d'obstacles cumulatif) sépare les nodes hérités qui se recouvrent et persiste. |
| D6 | **Nodes figés** | Le `kernel` (`movable:false`) fait office de **mur** : jamais poussé, jamais traversé. Sa box (auto-dimensionnée) est **mesurée une fois et mise en cache** (§8). |
| D7 | **Tests** | `node --test` (runner natif, **zéro dépendance npm**) pour la géométrie pure ; **Playwright** (navigateur) pour le comportement réel. |
| D8 | **Multi-ouverture éditeur** *(défaut proposé)* | Double-clic = **toujours un nouvel éditeur** (comportement actuel conservé), placé dans le 1er trou libre proche de l'explorateur. Réutilisation/focus = futur. |

## 4. Architecture

### 4.1 Position « home » (modèle) vs position « rendue » (transitoire)

Pivot qui rend le « revient après passage » (D1) propre.

- **home** = `node.x/y` — la place de **repos**, persistée. Ne change que lors d'un
  déplacement *du node lui-même*, d'un décalage **permanent** (exception D1, resize
  D3, réconciliation D5) ou d'un spawn.
- **rendu** = un `transform: translate(dx, dy)` **transitoire** posé sur le
  `.node-wrap`, en coordonnées **monde** (le wrap hérite du `scale()` de `.world`,
  cohérent avec `offsetWidth` déjà en coords monde).

🛡️ **Règles strictes** :
- La *home box* d'un node se lit toujours sur **`node.x/node.y`** (jamais
  `wrap.style.left`, qui vaut le home mais ne doit pas servir de source). Le
  `translate` est **séparé** et n'est **jamais** réécrit dans `node.x/y` avant un
  décalage permanent.
- **Saisir un node actuellement écarté** : on **remet d'abord son `translate` à
  zéro** (origine = son *home*), puis le drag part de là. (Pas de drag depuis une
  position transitoire.)

### 4.2 Module de géométrie pur — `frontend/static/js/collision.js`

🛡️ **Script classique** (pas ESM) : `collision.js` ne fait aucun `import`, donc il
s'inclut comme `canvas.js`. Il définit ses fonctions puis les expose des **deux**
côtés pour être à la fois chargé au navigateur et testé sous Node :

```js
// fin de collision.js
const MekiCollision = { intersects, isFree, partVector, pushVector, clampAgainst, findFreeSpot };
if (typeof module !== 'undefined' && module.exports) module.exports = MekiCollision; // node --test
if (typeof window !== 'undefined') window.MekiCollision = MekiCollision;             // navigateur
```

Inclus **avant** `canvas.js` dans `templates/canvas.html` (l.11) :
`<script defer src="/static/js/collision.js"></script>`.

Fonctions **pures** sur des boîtes `{x, y, w, h}` :

| Fonction | Rôle |
|----------|------|
| `intersects(a, b, gap)` | Recouvrement AABB avec marge `gap`. |
| `isFree(box, others, gap)` | `box` ne recoupe aucune des `others`. |
| `partVector(mover, obstacle, dragDir, gap)` | 🛡️ Calcule **les deux** déplacements perpendiculaires (±) sortant `obstacle` du couloir ; retourne le **candidat de plus petit \|déplacement\|** d'abord, l'autre côté en secours. Axe perpendiculaire dérivé de la **MTV** entre les box (pénétration min), `dragDir` ne sert que d'indice de **signe / départage**. « Côté naturel » = `sign(obstacleCenter − moverCenter)` sur l'axe perpendiculaire, **tie-break seulement**. |
| `pushVector(grower, obstacle, gap)` | MTV pour sortir `obstacle` du `grower`, 🛡️ **contraint au quadrant de croissance** (composantes négatives interdites pour un resize bas-droite). |
| `clampAgainst(moverHome, dragTo, obstacle, gap)` | 🛡️ Borne `mover` au contact en **bloquant l'axe de pénétration MINIMALE (MTV)** et en laissant glisser l'autre (collide-and-slide). Égalité → bloque l'axe **opposé au sens dominant** du drag. |
| `findFreeSpot(anchor, size, others, gap)` | 🛡️ 1er emplacement libre en **spirale** : pas = `max(size.w, size.h) + gap`, **rayon max borné** (cap configurable). **Repli déterministe** si rien de libre dans le cap : position la plus éloignée des `others` au bord du cap (jamais de boucle infinie). |

`dragDir` = 🛡️ **vecteur cumulatif** point-de-saisie → curseur (stable), avec
**hystérésis** sur l'axe dominant (dead-zone : ne bascule que si `|dx| > 1.3·|dy|`
ou inversement ; axe **verrouillé par obstacle** pour la durée du drag).

> La géométrie exacte est **figée par les tests** (§9). La spec fixe l'intention,
> les invariants et les pièges identifiés.

### 4.3 Câblage dans `canvas.js`

- `nodeBox(wrap, node)` : `{x, y, w, h}` en coords monde. 🛡️ `x/y` = `node.x/node.y` ;
  `w/h` = **explicites si présents** (éditeur 520×440, explorateur 300×380), sinon
  `offsetWidth/offsetHeight` (kernel — mesuré, voir §8).
- `onMove`/`finish` : voir §5.1 (déplacement) et §5.2 (resize).
- `editorPosAt`/`openFileInNewEditor` : réécrits via `findFreeSpot` + réservation
  (§5.3).
- `init` : passe de réconciliation après `renderNodes` + mesure du kernel (§5.4).

### 4.4 CSS — l'effet « léger »

`.node-wrap { transition: transform .12s ease-out; }`. 🛡️ **Précision** : le node
déplacé A suit le curseur via `left/top` (qui **n'ont aucune transition** —
inutile de la couper) ; la classe `.dragging { transition: none; }` ne sert qu'à
**supprimer la transition du `transform`** au cas où A porterait un translate
résiduel. Les **autres** nodes (qui s'écartent/reviennent) glissent via la
transition sur `transform`.

## 5. Comportements détaillés

### 5.1 Déplacement (le cœur)

Pendant le drag de A (boucle `onMove`), à chaque frame :

1. A suit le curseur (`left/top`, inchangé).
2. On **repart de zéro** ; on accumule au fur et à mesure les **box cibles déjà
   décidées** de cette frame (🛡️ pour que deux voisins écartés simultanément ne
   visent pas le même trou). Pour chaque autre node **B** dont la *home box*
   (gonflée de `GAP`) recoupe la **box courante de A** :
   - **B figé (`kernel`)** → `clampAgainst(B.box)` : A s'arrête au contact (D6).
   - **B mobile** → `partVector` essaie le **côté court** puis, s'il n'est pas
     `isFree` (vs *home* des autres + box cibles déjà décidées + kernel),
     **l'autre côté**. 🛡️ Si **les deux** échouent → `clampAgainst(B.home)` (D2).
     Sinon on pose le `translate` retenu sur B (animé).
   - A peut écarter **plusieurs** nodes touchés directement ; aucun n'en pousse un
     autre (pas de cascade).
3. **Retour avec hystérésis** 🛡️ : un node n'est ramené à `translate(0,0)` que
   lorsque la séparation avec A dépasse `GAP + ε` (engage à `>GAP`, release à
   `>GAP+ε`) — évite le clignotement engage/relâche au contact.

**Au lâcher (`finish`) — passe finale unique, 🛡️ seule autorité de l'invariant** :
1. Pour **chaque** node B (indépendamment de tout état « écarté » transitoire)
   dont la *home box* recoupe la **box finale de A** : B ne peut pas occuper sa
   place → **décalage permanent** via `findFreeSpot` (en évitant A et les autres).
2. Séquence d'écriture pour chaque node déplacé/décalé (🛡️ ordre imposé, sans
   double animation) : `node.x/node.y = nouveau home` → effacer le `translate` →
   `applyBox(wrap, node)` → `persistNode(node)`.
3. Les nodes qui n'entrent pas en conflit reviennent (`translate(0,0)`), sans
   persist.
4. 🛡️ **Persister A en dernier** (après les voisins relogés) : un échec réseau
   partiel ne laisse jamais A déplacé sans ses voisins enregistrés ; le boot
   réconcilie (§5.4, §6).

### 5.2 Redimensionnement (D3)

Branche resize de `onMove` (ancre haut-gauche, A grandit vers le bas-droite) :
1. Nouvelle taille (clamp min/`max_*` existants `clampW/clampH`).
2. Pour chaque B recouvert par la **box agrandie** : `pushVector` 🛡️ **contraint
   au quadrant bas-droite** (jamais pousser vers le haut/gauche, par-dessus l'arête
   ancrée). Cible libre → `translate` (B **reste** écarté, pas de retour). Bloquée
   par un 3ᵉ node/kernel → **borner la taille** au contact.
3. Au lâcher : figer les *home* des B poussés (même séquence §5.1, étape 2),
   persister les B puis A.

### 5.3 Spawn (D4)

🛡️ `editorPosAt(slot)` (cascade `slot*28`) et la réservation `_editorSpawns` sont
**remplacés** : `openFileInNewEditor` place le nouvel éditeur via
`findFreeSpot(ancre, tailleÉditeur, autresNodes, GAP)` depuis l'ancre « à droite de
l'explorateur ». Pas de spirale **serré** → éditeurs **groupés** près de
l'explorateur, pas dispersés hors écran.

- **Taille** : 520×440 vient du **backend** (`file_editor.py`) ; le node POSTé
  revient déjà dimensionné → `findFreeSpot` utilise `node.w/node.h` **de la
  réponse**. Pour la **réservation synchrone** avant l'await, une constante miroir
  `EDITOR_SPAWN_SIZE = {w:520, h:440}` (commentée « refléter `file_editor.py` »,
  couverte par un test de cohérence §9).
- 🛡️ **Concurrence** (rôle de l'ancien `_editorSpawns`) : deux double-clics
  rapprochés doivent **réserver** leur box choisie dans un ensemble « pending » que
  `findFreeSpot` évite, sinon les deux spawns async visent le même trou avant que
  l'un soit dans le DOM.
- Le bump de `z-index` de `selectNode` (« atteindre le bouton fermer d'un node
  masqué ») devient **sans objet** (plus de recouvrement) mais reste inoffensif et
  utile pendant un écartement transitoire — on le **garde**.

### 5.4 Réconciliation au chargement (D5)

Dans `init`, après `renderNodes(nodes)` :
- 🛡️ **Mesure** : éditeur/explorateur ont des `w/h` explicites (utilisés tels
  quels) ; le **kernel** (seul auto-dimensionné, contenu **synchrone** = un header)
  est mesuré une fois (offset stable immédiatement). Tout futur node auto-dimensionné
  à contenu **async** devra être mesuré après stabilisation (rAF/ResizeObserver).
- 🛡️ **Passe unique ordonnée déterministe** : on place d'abord les figés
  (`movable:false`, dont le kernel), puis les mobiles **triés par `id`** ; chaque
  node déjà placé devient **obstacle** pour les suivants → `findFreeSpot` les évite
  d'emblée. Un seul passage suffit et le résultat est **stable** (deux boots du même
  `canvas.json` donnent la même disposition).
- 🛡️ Source de vérité de `movable` = `wrap.dataset.movable` (réimposé côté backend
  par `reconcile_constraints`), **pas** le JSON brut.
- On **persiste** chaque node effectivement déplacé. `centerOnKernel` ne tourne que
  sur viewport par défaut → ne se bat pas avec la réconciliation.

## 6. Persistance

Réutilise **tel quel** `POST /api/canvas/nodes/{id}` (champs `x/y/w/h` optionnels,
appliqués conditionnellement, *finite-safe*, écriture atomique). Un geste peut
reloger plusieurs nodes → plusieurs POST **best-effort** (motif existant
`persistNode`), 🛡️ **A persisté en dernier**. 🛡️ **Contrat de cohérence
explicite** : en cas d'échec partiel, la **réconciliation au boot** (§5.4, devenue
déterministe) rétablit l'invariant. Un endpoint *bulk* reste **YAGNI**.

## 7. Constantes & réglages

- `GAP` (≈ 12 px monde) : marge anti-contact + respiration.
- `ε` d'hystérésis (≈ 4 px) : release > `GAP+ε`.
- Durée de transition : `.12s` (cohérence existante).
- `findFreeSpot` : pas = `max(w,h)+GAP`, rayon max = cap (ex. quelques milliers de
  px monde), repli déterministe au bord du cap.
- `EDITOR_SPAWN_SIZE = {w:520, h:440}` (miroir `file_editor.py`).

## 8. Cas limites & risques

- 🛡️ **Seul node auto-dimensionné = le `kernel`** (header synchrone) → mesuré +
  **mis en cache** une fois après rendu pour servir de box-mur stable. *Option* :
  lui donner des `w/h` explicites dans `kernel.py` (mur déterministe) — petit
  changement backend, à trancher au plan. Éditeur/explorateur ont des `w/h`
  explicites → pas de course de mesure async.
- 🛡️ **Drag diagonal / ~45°** : axe de poussée dérivé de la **MTV** (pas du seul
  « axe dominant »), `dragDir` lissé/cumulatif + hystérésis → pas de flip d'axe par
  frame. `clampAgainst` glisse le long de la face heurtée (jamais de saut de l'autre
  côté du mur).
- 🛡️ **A entouré** (les deux côtés bloqués partout) : A reste collé à sa position
  de contact (comportement attendu de D2). Compromis « banc de poissons » assumé —
  l'essai des **deux** côtés limite les blocages ; un test Playwright mesure la
  fréquence de blocage sur un canvas représentatif (§9).
- 🛡️ **Saisir un node écarté** : reset du `translate` avant de driver le drag (§4.1).
- 🛡️ **Échec de persistance partiel** : rattrapé par la réconciliation au boot (§6).
- **`kernel` central** : jamais déplacé/traversé/poussé hors écran.
- **Stacking/transform** : le `transform` crée un contexte d'empilement ; cohabite
  avec le `z-index` de `selectNode` (inoffensif).
- **Performance** : test AABB O(n²) par frame, négligeable au nombre de nodes visé.

## 9. Stratégie de test (D7)

**Géométrie pure (`node --test`, zéro dep)** — `frontend/static/js/collision.test.js` :
- `intersects` (recouvrement, contact, séparé, effet `gap`) ;
- 🛡️ `partVector` : côté court préféré, **bascule sur l'autre côté** si bloqué,
  pas de flip d'axe à **exactement 45°**, tie-break par côté naturel ;
- 🛡️ `clampAgainst` : bloque l'axe **MTV (pénétration min)**, glisse sur l'autre ;
  approche d'un coin de mur en diagonale → glisse, ne saute jamais de l'autre côté ;
- 🛡️ `pushVector` : voisin près du coin haut-gauche d'un resize bas-droite poussé
  **bas/droite**, jamais haut/gauche ;
- 🛡️ `findFreeSpot` : trou trouvé, spirale bornée, **« rien de libre » → position
  finie déterministe** ;
- 🛡️ `isFree` : deux box cibles décidées dans la même frame n'entrent pas en
  conflit.

**Comportement (Playwright / navigateur)** — drag réel + assertions :
- déplacement → le percuté s'écarte puis **revient** ; **aucun chevauchement** à
  tout instant (assert sur les rects) ; capture d'écran ;
- 🛡️ lâcher sur le *home* d'un node (y compris un node **jamais écarté** car bloqué)
  → ce node est **décalé** par la passe finale (D1, blocker corrigé) ;
- no-cascade → A **bloqué** quand les deux côtés sont pris (D2) ;
- 🛡️ deux voisins écartés simultanément → pas de chevauchement transitoire entre eux ;
- resize → voisin poussé **reste** écarté (bas/droite) ; resize **borné** si bloqué (D3) ;
- spawn → nouvel éditeur dans un **trou libre groupé** près de l'explorateur (D4) ;
- 🛡️ deux double-clics rapprochés → deux éditeurs **distincts** (réservation) ;
- canvas hérité avec chevauchement → **séparé** au chargement, **disposition stable**
  sur deux boots (D5) ;
- `kernel` jamais déplacé (D6).

> Rappel mémoire projet : valider le front avec Playwright (screenshot + console)
> avant de dire « ça marche » — un HTTP 200 ne prouve pas l'exécution JS.

## 10. Fichiers touchés

- **+** `frontend/static/js/collision.js` — géométrie pure, 🛡️ **script classique**
  (`window.MekiCollision` + `module.exports`, pas d'`export` ESM).
- **+** `frontend/static/js/collision.test.js` — tests `node --test`.
- `frontend/static/js/canvas.js` — `onMove`/`finish` (move + resize),
  🛡️ `openFileInNewEditor`/`editorPosAt` + suppression de `_editorSpawns` (→
  `findFreeSpot` + réservation), réconciliation + mesure kernel dans `init`, helper
  `nodeBox`, reset-transform à la saisie.
- `frontend/static/css/canvas.css` — `transition: transform` sur `.node-wrap`,
  classe `.dragging`.
- 🛡️ `frontend/templates/canvas.html` — `<script defer src="/static/js/collision.js">`
  **avant** `canvas.js` (l.11). *(Pas `routes/canvas.py` : aucun `<script>` là-bas.)*
- *(Option)* `backend/nodes/kernel.py` — `w/h` explicites pour un mur déterministe.
- **Backend (routes/models) : aucun changement requis.**

## 11. Découpage en étapes TDD (entrée du plan)

1. **Géométrie pure** — `collision.js` + `collision.test.js` (`node --test`) :
   `intersects`, `isFree`, `partVector` (2 côtés), `pushVector` (quadrant),
   `clampAgainst` (MTV), `findFreeSpot` (bornée + repli).
2. **Câblage déplacement** — parting (2 côtés) + return avec hystérésis (D1 hors
   exception) ; `dragDir` cumulatif ; box cibles cumulées par frame.
3. **No-cascade & kernel-mur** — `clampAgainst` + blocage des deux côtés (D2, D6) ;
   mesure + cache de la box kernel.
4. **Passe finale au lâcher** — décalage permanent indépendant de l'état écarté +
   séquence d'écriture + persist A en dernier (D1 blocker).
5. **Spawn free-spot** — `openFileInNewEditor`/`editorPosAt` réécrits, réservation
   anti-concurrence, constante miroir + test de cohérence (D4, D8).
6. **Redimensionnement** — pousse-et-reste contraint + clamp (D3).
7. **Réconciliation au load** — passe ordonnée déterministe + persistance (D5).
8. **Validation navigateur** — scénarios Playwright + captures (§9).

Chaque étape : test (rouge) → implémentation (vert) → commit, comme le Jalon 1.
