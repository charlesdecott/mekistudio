# mekistudio — Vue d'ensemble

## But du projet

mekistudio est un studio de développement Python-first piloté par l'IA. C'est le successeur de mekidesign. L'objectif phare est résumé en une phrase : **importer mekistudio dans lui-même et laisser Claude l'améliorer**. Le studio peut ouvrir son propre dépôt comme projet, laisser Claude Code proposer des modifications dans une branche isolée (git worktree), et fusionner le résultat en toute sécurité.

## Philosophie

- **Minimal** : pas de framework frontend lourd, pas d'étape de build. Le studio tourne sans Docker en une seule commande.
- **Python-first** : toute la logique métier est en Python pur, sans dépendance à des outils Node.js ou de compilation JS.
- **Sandboxé par défaut** : en production l'agent Claude s'exécute dans un conteneur Docker qui n'a accès qu'à `~/meki-projects`. En mode développement (`--no-sandbox`) l'agent a accès complet au système de fichiers hôte — usage réservé aux contributeurs du studio.
- **Auto-upgrade sûr** : la session de chat peut cibler le dépôt du studio lui-même. Les fichiers écrits sont scoped au `cwd` du projet ; tout outil qui contournerait cette limite doit rejeter explicitement les chemins qui s'en échappent. Le démarrage doit survivre à une dérive de schéma dans `~/.mekistudio/*.json` (parse avec Pydantic, log + ignore les enregistrements invalides, jamais de crash).

## Règle de layering (invariant fondamental)

```
backend/  ←  frontend/  ←  cli.py (câblage unique)
```

- `backend/` ne doit **jamais** importer depuis `frontend/`.
- `frontend/` dépend de `backend/`, jamais l'inverse.
- `packages/cli.py` est le **seul** endroit où les deux couches sont câblées ensemble.

## Capacités principales

| Capacité | Description |
|---|---|
| Dashboard | Crée un projet vide (git-init), importe via URL Git, importe un dossier local |
| Chat | Conversation avec Claude CLI dans le répertoire du projet, streaming de chaque token |
| Hooks panel | Flux en temps réel de tous les événements Claude (`PreToolUse`, `PostToolUse`, `Stop`…) |
| Canvas | Vue infinie avec des nœuds positionnables (chat, git, fichiers, terminal) |
| Worktrees | Un worktree git par branche de feature, avec état de chat et canvas isolés |
| Terminaux | Sessions PTY dans le navigateur, via pywinpty sur Windows |
| Self-upgrade | Le studio peut se patcher lui-même via un worktree feature |
