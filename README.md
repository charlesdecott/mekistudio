# mekistudio

AI dev studio en pur Python, sans Docker. Auto-hébergé : un seul repo, qui se
met à jour lui-même via `mekistudio update`.

## Démarrer

```bash
uv sync --extra dev
uv run mekistudio serve        # ouvre http://127.0.0.1:8777/
```

`mekistudio serve` crée `.mekistudio/` dans le repo courant s'il n'existe pas,
puis ouvre le canvas principal.

## Installer en global (commande `mekistudio` sur le PATH)

```bash
uv tool install --editable --force .   # depuis la racine du repo
mekistudio serve                       # lançable de n'importe où
```

L'install **editable** fait pointer l'outil global vers ce repo : le code est
lu en direct. Éditer la source (ou `git pull`) est pris en compte au prochain
`mekistudio serve` — aucun rebuild, aucun exe à réécrire.

## Se mettre à jour

```bash
mekistudio update              # git pull la source (le code editable est live)
mekistudio update --restart    # arrête l'instance en cours, pull, relance serve
```

`--restart` arrête le `serve` en cours (via `.mekistudio/serve.pid`), fait le
`git pull`, puis relance un `serve` **frais** en avant-plan (il réimporte le
code à jour). `--port` choisit le port relancé (défaut 8777).

Si les **dépendances** (`pyproject.toml`) ont changé, relance, studio arrêté :
`uv tool install --editable --force .`

## Tests

```bash
uv run pytest
```
