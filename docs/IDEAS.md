# Boîte à idées — mekistudio

Features envisagées mais **pas encore planifiées**. Notées au fil de l'eau pour
ne rien perdre ; à promouvoir dans `ROADMAP.md` quand on décide de les faire.

## Node éditeur de fichiers (`fileEditor`) — base

Lire / éditer / sauvegarder un fichier façon VSCode : coloration syntaxique
(mots-clés), guides de blocs d'indentation. **Node socle** dont on dérive les
suivants. _(Prochain à implémenter.)_

### Dérivés

- **Éditeur Markdown + preview** : édition à gauche, rendu à droite (graphes
  type mermaid, images, tableaux, etc.).
- **Diff du fichier vs HEAD** : afficher la diff git du fichier par rapport au
  dernier commit (lecture seule + couleurs add/del).
- **Comparaison de 2 implémentations** : diff côte à côte de deux fichiers /
  deux versions pour comparer des approches.

> Ces dérivés partagent le moteur d'édition/coloration du `fileEditor` (réutilisation
> des composants, comme la vision lego). On les sortira un par un, spec → TDD → merge.

## Canvas — anti-chevauchement & collision « douce » des nodes

Les nodes ne doivent **en aucun cas se superposer**. Quand on déplace un node et
qu'un autre se trouve sur son chemin, appliquer un **effet de collision léger** :
le node percuté est poussé hors du passage (animation douce) pour laisser passer
le node déplacé, au lieu de le laisser le recouvrir. Esprit « on écarte les
meubles » : invariant *zéro recouvrement* maintenu en continu.

> Points à trancher en spec : le node poussé **reste-t-il écarté** ou **revient-il**
> après le passage ? la poussée se **propage-t-elle en chaîne** (cascade) quand
> plusieurs nodes sont alignés ? s'applique-t-elle aussi au **redimensionnement**
> et au **spawn** (aujourd'hui les éditeurs se chevauchent *volontairement* en
> cascade — cf. `openFileInNewEditor`/`editorPosAt`) ? le `kernel` figé fait
> office de **mur**.

## Canvas — relier les nodes avec une logique (wires)

J'aimerais **relier les nodes entre elles avec une certaine logique** (sortie d'un
node → entrée d'un autre), pour matérialiser le flux qui circule sur le canvas.
Pour le tracé des fils, on partira sur la méthode **subway + ribbon** (segments à
45° + regroupement des fils parallèles en ruban — cf. `docs/raw/cables/ue5_cablemanagement.md`).
