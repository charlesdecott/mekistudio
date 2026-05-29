# mekistudio-2

AI dev studio en pur Python, sans Docker. Reconstruit petit à petit.

## Démarrer

```bash
uv sync --extra dev
cd /chemin/vers/un/repo/git
uv run mekistudio run        # ouvre http://127.0.0.1:8777/
```

`mekistudio run` crée `.mekistudio/` dans le repo s'il n'existe pas, puis
ouvre le canvas principal.

## Tests

```bash
uv run pytest
```
