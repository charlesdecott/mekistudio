# mekistudio-lego — Vue d'ensemble

**Date de référence :** 2026-05-28
**Branche source :** `refactor/canvas-lego` (worktree `C:\sandbox-dev\workspace\mekistudio-lego`)

---

## Ce que mekistudio-lego change par rapport à mekistudio

### Le problème dans mekistudio original

Le canvas original encode chaque type de node ("kind") de façon rigide à trois endroits simultanément :

- Le template HTML principal (`project_canvas.html`) — un bloc conditionnel par kind.
- Le fichier de macros Jinja (`_macros.html`) — un macro `canvas_X_panel` par kind, certains dépassant 100 lignes.
- Le fichier JavaScript principal (`app.js`) — le factory `projectCanvas()` qui instancie et câble chaque kind statiquement, avec des fonctions dupliquées d'un kind à l'autre.

Résultat : ajouter un nouveau type de node impose de toucher quatre fichiers simultanément, de dupliquer du code existant, et sans aucune réutilisation entre les types. La maintenabilité s'effondre à partir du 6e kind.

### La réponse de mekistudio-lego

Le fork remplace ce modèle monolithique par un **système compositionnel de briques**. Un node n'est plus un bloc monolithique hard-codé, mais un **arbre de briques Pydantic** connecté par un **graphe de câbles typés**.

Les trois surfaces d'édition du canvas (fichiers Python/YAML, API REST, interface "mode build") convergent toutes vers une unique source de vérité Pydantic. Un agent IA (Claude) et un humain via l'UI utilisent exactement la même API pour construire ou modifier le canvas.

---

## Objectifs du fork

### Composabilité

Chaque node est assemblé à partir de briques génériques réutilisables. La brique `NodeFrame`, la brique `HeaderBar`, la brique `MessageList` sont des primitives qui peuvent être combinées dans n'importe quel node. Deux nodes peuvent partager 90 % de leur structure en réutilisant les mêmes briques.

### Modifiabilité sans code

Trois surfaces d'édition convergent vers une source de vérité unique :
1. **Fichiers Python** — les NodeDef built-in, versionnés dans git.
2. **Fichiers YAML** — les NodeDef custom de l'utilisateur, dans `.mekistudio/nodes/`.
3. **API REST + mode "build"** — création et modification en live, sans redémarrer le serveur.

### Auto-upgrade sécurisé

L'objectif déclaré du projet mekistudio est de "s'importer lui-même et laisser Claude l'upgrader en toute sécurité". Le canvas-lego est l'infrastructure qui rend cet auto-upgrade jouable côté UI : Claude peut appeler les mêmes endpoints REST qu'un humain pour créer, modifier, ou supprimer des nodes et des briques.

### Stabilité pendant la migration

La migration est réalisée en 11 PRs verticales, chacune protégée par des tests Playwright de régression visuelle. Un feature flag (`canvas_v2_kinds`) permet de faire coexister l'ancien et le nouveau rendu sur le même canvas pendant toute la durée de la migration.

---

## Ce que le fork ne change pas

- La répartition backend Python / frontend Alpine.js reste inchangée.
- Les performances ne régressent pas : les briques utilisent Jinja pour le rendu initial et Alpine pour la réactivité, exactement comme avant.
- L'UX reste pixel-identique à l'original à chaque étape de la migration.

---

## Résultat final

Après 11 PRs (toutes complétées dans le fork) :
- **13 kinds** entièrement migrés vers le moteur de briques.
- **-217 lignes** nettes sur la surface canvas (macros figés et branches `x-if` supprimés).
- Un mode "build" dans la toolbar permet d'ajouter nodes et briques via palette interactive.
- L'API REST canvas est le canal unique que Claude et l'UI build utilisent l'un comme l'autre.
