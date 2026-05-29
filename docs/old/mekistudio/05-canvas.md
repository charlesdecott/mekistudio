# 05 — Canvas infini

## Concept

Le canvas est la surface principale de mekistudio. C'est un espace de travail 2D infini, navigable par pan (glisser sur le fond) et zoom (molette), sur lequel tous les panneaux du projet sont disposés comme des **nodes** librement positionnables. L'idée centrale : l'espace remplace les onglets. Chaque conversation, vue git, terminal, éditeur de fichier ou service a une position persistante sur la toile.

---

## Topologie des nodes

Au lancement du canvas, une topologie est construite automatiquement :

```
chat  →  mekicore  →  git_status / git_diff
                   →  worktrees_hub  →  worktree_chat:*  (si des worktrees existent)
```

- **chat** : le panneau de conversation principale, ancré en haut à gauche.
- **mekicore** : hub centralisant les actions git du projet (fetch, push, pull, créer une branche, créer un worktree) et l'état du remote.
- **git** : nœud affichant le statut de l'arbre de travail et le log.
- **worktrees_hub** : nœud sommaire, un seul point d'entrée vers les worktrees actifs.
- **worktree_chat** : un panneau de conversation autonome par worktree, identique au chat principal.
- **terminal** : PTY interactif (xterm.js), créé à la demande.
- **browser** : iframe de prévisualisation, avec normalisation d'URL (YouTube, bare host:port).
- **file_explorer** : arborescence lazy-loadée, cliquable pour ouvrir des fichiers.
- **file_editor** : éditeur CodeMirror 6, avec save optimiste basé sur `mtime_ns` (conflits 409 détectés).
- **service** : panneau de log en lecture seule pour un service en cours d'exécution.

---

## Les « pulses » synchronisés

La propriété visuellement distinctive du canvas est la **synchronisation des pulses**. Lorsqu'un agent termine son tour (`AgentEnd`), le canvas déclenche une cascade :

1. Une étincelle (cercle animé) part du node chat vers le node git via le câble SVG qui les relie.
2. Elle suit une courbe de Bézier avec un easing `easeInOutQuad`, gérée par une boucle `requestAnimationFrame` en DOM impératif.
3. La réception dans le node git ne se produit qu'**après** l'arrivée visuelle de l'étincelle — la Promise `spark(from, to)` résout à l'arrivée.
4. Le git panel se rafraîchit alors (appel API `git/overview`), et un nouveau pulse part vers `git_status`.

Ce séquençage intentionnel garantit que le rafraîchissement visuel et le chargement des données semblent arriver ensemble, sans désynchronisation perceptible.

Les câbles SVG et les pulses sont gérés en DOM impératif (manipulation directe des éléments SVG) plutôt que via `x-for` Alpine, car Alpine avait des comportements incorrects de réconciliation sur des listes SVG changeant de taille à chaque frame.

---

## Persistance de la disposition

Les positions, dimensions, vue (panX, panY, zoom) et métadonnées de chaque node sont persistées dans `canvas.json` via `CanvasStore` (côté backend, stocké dans `~/.mekistudio/projects/<id>/worktrees/<branch>/canvas.json`). La sauvegarde est déclenchée en debounce après chaque glissement de node ou changement de vue.

Le format est un dictionnaire `{ nodes: { <id>: { x, y, w, h, kind?, url?, path? } }, view: { panX, panY, zoom } }`. Les ids inconnus sont conservés (compatibilité ascendante) ; les ids manquants tombent sur les défauts du front-end.

---

## Transport WebSocket et consommation Alpine

Le canvas n'a pas de WebSocket propre. Il délègue entièrement à `chatController`, une factory Alpine réutilisable partagée entre la page `/chat` et les nodes de conversation du canvas.

`chatController` :
- Ouvre une connexion `/ws/chat` sur `init()`.
- Envoie `{ type: "attach", project_id, conversation_id, worktree_branch }` dès l'ouverture.
- Ingère les événements normalisés du bridge et les traduit en mutations du tableau `messages` (streaming token-par-token via `TextDelta`, bulles d'outils, bulles de thinking collapsibles, formulaires `AskUserPrompt`).
- Dispatch l'événement Alpine `chat-agent-end` à la fin de chaque tour ; le canvas écoute cet événement pour déclencher la cascade de pulses.

---

## Rendu des messages

- **Texte** : rendu Markdown via `marked` + DOMPurify (sanitisation HTML).
- **Thinking** : bulle distincte, collapsée automatiquement à `MessageEnd`.
- **Tool cards** : chaque outil a une icône et une teinte de couleur définie dans `TOOL_META`.
- **AskUserQuestion** : formulaire interactif (checkboxes single/multi, champ libre) ; la soumission envoie `{ type: "answer_ask_user", tool_use_id, answers }` via WebSocket.

L'état initial (IDs, branch, worktrees) est injecté côté serveur dans une balise `<script type="application/json" id="initial-state">` pour éviter le problème de double-échappement Jinja/Alpine documenté dans les lessons du projet.
