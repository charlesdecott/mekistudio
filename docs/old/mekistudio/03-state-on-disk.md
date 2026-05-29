# État sur disque

## Deux racines, deux natures

L'état de mekistudio est séparé en deux emplacements dont les rôles sont strictement distincts.

**Machine-local** (`~/.mekistudio/`) : tout ce qui est transitoire, propre à la machine ou spécifique à l'utilisateur. N'est jamais commité. Peut être supprimé avec `mekistudio uninstall --purge` sans perte de code.

**Par projet** (`<projet>/.mekistudio/`) : uniquement ce qui doit voyager avec le code. Typiquement commité dans le dépôt. Permet à un même projet d'être reconnu sur plusieurs machines via son identifiant stable.

## Layout complet

```
~/.mekistudio/                              ← machine-local
  config.json                               ← MekiConfig (port, clé API, workspace_dir…)
  projects.json                             ← registre de tous les projets importés
  logs/
  projects/<project_id>/
    worktree-labels.json                    ← labels cosmétiques branch → nom affiché
    git-worktrees/<branch-slug>/            ← cibles des `git worktree add`
    worktrees/<branch-or-_primary>/
      conversations/<conv_id>/
        meta.json                           ← { id, title, created_at_ms, claude_session_id }
        messages.jsonl                      ← flux append-only d'événements normalisés
        hooks.jsonl                         ← flux append-only de hooks Claude
      canvas.json                           ← positions des nœuds + viewport
      logs/

<projet>/.mekistudio/                       ← commité (opt-in)
  manifest.json                             ← { id, name, schema_version }
  agents/  skills/  docs/                   ← futurs, opt-in
```

## Détail des fichiers clés

**`config.json`** : paramètres utilisateur (`port`, `bind_host`, `workspace_dir`, `anthropic_api_key`, `docker_image_tag`, `git_user_name/email`). Parse Pydantic avec `extra="ignore"` — une dérive de schéma ne crashe jamais le CLI, il revient aux valeurs par défaut.

**`projects.json`** : liste de `Project` sérialisés (`id`, `name`, `path`, `source`, `created_at`). Même tolérance de parse : les enregistrements invalides sont ignorés silencieusement.

**`meta.json`** (par conversation) : métadonnées de la conversation. Contient `claude_session_id` — l'identifiant de session capturé depuis le SDK lors du dernier échange. Passé en paramètre `resume=` au prochain démarrage du bridge pour que le modèle retrouve le contexte complet, même après un redémarrage du processus.

**`messages.jsonl`** : flux append-only d'événements normalisés. Rejoué intégralement à chaque reconnexion WebSocket pour reconstruire l'affichage. Format JSONL (une ligne = un événement JSON) pour des appends O(1) sans relire le fichier entier.

**`hooks.jsonl`** : même principe que `messages.jsonl` mais pour les événements hooks (`PreToolUse`, `PostToolUse`, `Stop`…). Séparé pour que le panel de hooks puisse être chargé indépendamment du chat.

**`canvas.json`** : layout du canvas infini — dictionnaire de positions de nœuds (`x`, `y`, `w`, `h`, `kind`) + état du viewport (`panX`, `panY`, `zoom`). Tolérant à la dérive : les nœuds inconnus dans le fichier sont conservés à la sauvegarde (compatibilité future), les nœuds manquants tombent sur des valeurs par défaut côté frontend.

**`manifest.json`** (dans le repo) : identité portable du projet. Si le dépôt est cloné sur une autre machine et importé, le studio réutilise le même `id` — l'historique de chat et le canvas de la machine source restent distincts, mais l'identité du projet (et ses configs partagées) sont préservés.

## Pourquoi ce split

- L'historique de chat doit **survivre à `git worktree remove`** : après une merge, le worktree git est supprimé, mais les conversations restent accessibles dans `~/.mekistudio/`.
- Les répertoires de worktrees git (`git-worktrees/<slug>/`) doivent rester **en dehors du repo** pour ne pas apparaître comme fichiers non-suivis dans `git status`.
- Le manifest commité dans `<projet>/.mekistudio/` permet à l'identifiant de projet de **voyager avec le code** entre machines, sans synchroniser l'état machine-local.
- La séparation évite aussi que l'agent qui patche le projet touche accidentellement à l'état du studio — le `WorktreeGuard` du bridge scopes les écritures au `cwd` du projet, pas à `~/.mekistudio/`.
