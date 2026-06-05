# Node `subcanvas` — cadre réductible générique (design)

**Date** : 2026-06-05
**Statut** : design validé, prêt pour le plan
**Brique** : H (sous-canvas)

## Intention

Introduire un node spécial qui se comporte comme **un canvas dans le canvas** : un
**cadre réductible générique** qui *contient* d'autres nodes — il les clippe, peut les
replier, et surtout **les sort de la collision du canvas principal**. Cas d'usage v1 :
confiner **tout le monde de l'explorateur** (arbre de dossiers + éditeurs spawné) dans un
seul conteneur, pour que la collision du canvas principal n'ait plus qu'**une boîte** à
gérer côté fichiers.

### Pourquoi

Aujourd'hui, chaque dossier ouvert crée une *zone-territoire* qui flotte dans le canvas
principal ; `separatePolys` (MTV) doit séparer toutes ces zones les unes des autres **et**
des nodes built-in (kernel/git/chat). En confinant le monde fichiers dans un conteneur,
la collision principale se réduit à `kernel / git / chat / subcanvas`, et tout le travail
de layout radial + dé-collision se fait **à l'intérieur**, isolé.

## Modèle mental retenu

**Cadre réductible** (parmi : conteneur toujours visible / sous-canvas qu'on « entre » /
cadre réductible) — deux états : **déplié** (on voit et manipule les nodes dedans, clippés)
et **replié** (une seule tuile compacte ; la collision se résume à la tuile). **Pas** d'état
plein-écran immersif (pas de second système pan/zoom) : quand le contenu est grand, c'est le
**pan/zoom du canvas principal** qui gère (cohérent avec le `fitView` existant).

## Topologie

```
kernel → git → { chat,  ▢ subcanvas → explorateur → { dossiers → éditeurs } }
```

- Nouveau node **built-in `subcanvas`**, parenté à **git** (prend l'ancien créneau de
  l'explorateur).
- L'**explorateur** redevient la **racine du layout radial**, mais **à l'intérieur** du
  conteneur.
- `chat`, `git`, `kernel` restent **dehors**, inchangés.

## Décisions de design

### Conteneur générique, un seul cas câblé (v1)

Le node `subcanvas` est **neutre** : il sait seulement « contenir / clipper / replier des
descendants ». En v1 on ne le branche qu'au **cas explorateur** (1 conteneur built-in,
migration auto). **Hors périmètre v1** : drag-in/out manuel de nodes arbitraires,
imbrication récursive de conteneurs.

### Appartenance = descendance dans l'arbre `source_id`

Un node est « dans » le conteneur ssi le conteneur est son **ancêtre** dans l'arbre
`source_id`. Purement **dérivé**, générique — aucune liste d'appartenance à maintenir.

### Coordonnées : absolues conservées, bornes du cadre dérivées

On **garde les coordonnées absolues** de tous les nodes (refonte minimale, pas de système de
coordonnées locales à composer dans le rendu/les câbles/la collision). Le `subcanvas` n'a
**pas** de position propre indépendante : ses **bornes sont dérivées** = boîte englobante de
tout son sous-arbre (explorateur épinglé + dossiers + éditeurs) + padding + barre de titre.
C'est le prolongement direct de `territories.js` (hull autour d'une zone), promu en vrai node
avec en-tête et repli.

**Déplacer le monde** = déplacer l'explorateur (racine épinglée du layout radial) ; le cadre
suit. Un drag sur la barre de titre du cadre translate la racine.

## Comportement détaillé

### Layout interne

`relayoutZones` tourne **comme aujourd'hui** (radial + `packAround` + `separatePolys`),
explorateur épinglé au centre. Sa sortie définit les bornes du cadre.

### Rendu

- **Déplié** : bordure + en-tête `📦`, descendants **clippés** (`overflow:hidden`). Grand →
  pan/zoom du canvas principal.
- **Replié** (`Node.collapsed`, déjà au modèle) : descendants **non rendus**, le cadre devient
  une **tuile compacte** (« 📦 fichiers ▸ »). Toggle dans la barre de titre.

### Collision (cœur du gain)

- Collision du **canvas principal** : uniquement les nodes de premier niveau
  (kernel / git / chat / **subcanvas, une seule boîte**). Les descendants du conteneur sont
  **exclus** de la collision principale et du `separatePolys` global.
- `separatePolys` continue **à l'intérieur** entre les blobs de dossiers — confiné, sans avoir
  à éviter chat/git/kernel.

### Câbles & comètes

- Dérivés de `source_id` : `git → subcanvas` (backbone, dehors) + `subcanvas → explorateur`
  (court, dedans). Câbles internes (explorateur→dossiers→éditeurs) **clippés** dans le cadre.
  **Aucun câble ne traverse réellement la frontière** : il passe par le conteneur, qui *est*
  la frontière.
- **Replié** : câbles internes masqués ; `git → subcanvas` pointe sur la tuile.
- **Comètes** chat→éditeur : routées `chat → git → subcanvas → … → éditeur`. Si le conteneur
  est replié (cible invisible), la comète **s'arrête et fait glow la tuile** du conteneur.

### Persistance & migration

- Pas de nouveau champ modèle (réutilise `collapsed`, `source_id`). Nouveau module
  `nodes/subcanvas.py` + entrée `NODE_BUILDERS` + `CANONICAL_PARENT_KIND`
  (`subcanvas→git`, `explorateur→subcanvas`).
- **Migration auto au chargement** (comme la brique G) : `subcanvas` absent → on l'insère et on
  **re-parente l'explorateur** (git→subcanvas) via `reconcile_source_links`. Built-in →
  non supprimable. Les canvas existants se mettent à niveau tout seuls.

## Tests

- **Python (pytest, TDD)** : `default_canvas()` contient le subcanvas avec la bonne
  topologie ; `reconcile_source_links` insère le conteneur + re-parente l'explorateur sur un
  vieux canvas (migration) ; idempotence ; subcanvas non supprimable ; `derive_source_id`
  range bien explorateur→subcanvas et garde dossiers/éditeurs sous l'explorateur.
- **JS pur (`node --test`)** : fonction d'**appartenance** (descendants d'un node dans l'arbre
  `source_id`) ; calcul des **bornes dérivées** du cadre à partir des boîtes du sous-arbre
  (englobante + padding + barre) ; partition collision (top-level vs internes).
- **Playwright** : le subcanvas s'affiche autour de l'explorateur ; dossiers/éditeurs **dedans**
  (clippés) ; déplié↔replié (tuile compacte, descendants masqués/réaffichés) ; **0 chevauchement**
  au niveau principal et stable au reload ; comète chat→éditeur arrive (ou glow tuile si replié) ;
  migration d'un canvas pré-subcanvas ; **0 erreur console**.

## Hors périmètre v1 (notes pour la suite)

- **Drag-in/out manuel** de nodes arbitraires dans un conteneur (ré-parentage à la souris).
- **Imbrication récursive**. **Vision future** : quand les **worktrees** arriveront, ils se
  connecteront au **kernel** (comme la node branche `main` aujourd'hui) ; chaque worktree + la
  branche `main` aura **son** `subcanvas`, et **dedans** un **autre** `subcanvas` pour
  l'explorateur. → le `subcanvas` doit rester **générique et imbricable** par conception, même
  si la v1 ne livre qu'un seul niveau.

> Les choix ci-dessus ont été validés un à un en brainstorm (companion visuel) :
> modèle = cadre réductible · conteneur générique, cas = monde explorateur · topologie =
> node dédié, explorateur dedans · pas de plein écran · déplié = grow-to-fit · périmètre
> v1 = explorateur seul.
