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
uv tool install --force .      # depuis la racine du repo
mekistudio serve               # lançable de n'importe où
```

## Se mettre à jour

```bash
mekistudio update              # git pull (si remote) + reconstruit l'outil global
```

Le swap prend effet au prochain lancement (un exe en cours ne peut être
écrasé) — relance `mekistudio serve` ensuite.

## Tests

```bash
uv run pytest
```
