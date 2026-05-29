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
