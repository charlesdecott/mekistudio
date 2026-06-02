# Fondation A — Studio conteneurisé + reverse-proxy mono-port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire tourner mekistudio dans un conteneur qui ne publie qu'un seul port (8777), avec un reverse-proxy Python intégré qui route par nom d'hôte vers des ports internes, et permet d'ajouter/retirer une route à chaud (0 restart, 0 WebSocket coupée).

**Architecture:** Un wrapper ASGI (`ProxyDispatch`) enveloppe l'app FastAPI du studio dans le **même process** uvicorn. Il lit l'en-tête `Host`, et : (a) host studio → forward in-process vers l'app studio (le `/ws/chat` reste interne, jamais tunnelisé) ; (b) host de service connu → tunnel HTTP streaming via `httpx` vers une cible loopback ; (c) host inconnu → **default-deny** (404). La table de routes vit en RAM dans un `RouteController` (backend) et se projette atomiquement dans `.mekistudio/routes.json` (re-seedée au boot). Le conteneur (Dockerfile multi-stage durci) embarque le studio + le CLI `claude` et bind-monte le repo.

**Tech Stack:** Python 3.11+, FastAPI/uvicorn, Pydantic v2, `httpx` (déjà dép), `websockets` (déjà dép), pytest + pytest-asyncio (auto mode), Docker (Compose), Caddy **non utilisé** (proxy maison).

**Référence spec :** `docs/superpowers/specs/2026-05-31-fondation-a-studio-conteneurise-design.md`

---

## Notes de périmètre (à lire avant de commencer)

- **Aucune nouvelle dépendance Python** : `httpx>=0.27` et `websockets>=13` sont déjà dans `pyproject.toml`. Ne pas faire `uv add`.
- **Tunnel WebSocket vers un upstream tiers = DIFFÉRÉ en phase B.** En phase A, le **seul** WebSocket est le `/ws/chat` du studio, qui est forwardé **in-process** par le dispatch (pas de tunnel `httpx`/`websockets`). Le dispatch gère quand même `scope['type'] == 'websocket'` : host studio → forward in-process ; host de service → **refus** (close `1011`, « WS tunnel non supporté en phase A »). C'est conforme à la DoD (le dev-server de test est HTTP).
- **Invariant de layering (CLAUDE.md) :** `backend/` n'importe **jamais** `frontend/`. Le `RouteController` et le modèle de route vivent dans `backend/` ; le proxy/dispatch et l'API admin vivent dans `frontend/`. `cli.py` est le seul câblage.
- **Seam Origin (anti-CSWSH) — différé.** La spec §3 veut un *seam* de vérification d'`Origin` au handshake WS, l'**enforcement** étant différé en phase C (cf. revue adversariale). Ce seam **est** la branche `scope['type'] == 'websocket'` de `ProxyDispatch.__call__` (Task 7) ; on n'écrit **pas** d'allowlist d'Origin en A (elle casserait TestClient/dev local et n'a pas de consommateur tant que le studio n'est pas exposé hors loopback).
- **SDK `sandbox.filesystem.denyRead` / env-scrub — hors A.** La spec §10 les liste comme « à réutiliser » : ce sont des **options du SDK** qui se câblent avec la **brique de réactivation des outils** (les outils sont OFF aujourd'hui), pas avec la Fondation A (conteneurisation + proxy). La frontière conteneur EST l'isolation en A ; `guard.py` (déjà présent, lecture seule default-deny) reste inchangé.
- **Conventions du repo :** `from __future__ import annotations` en tête de chaque module ; commentaires = le *pourquoi* (en français) ; Pydantic v2 (`model_dump(mode="json")`). TDD : un test qui échoue d'abord, puis le code minimal.
- **Lancer les tests :** depuis `C:\mekistudio`, commande `python -m pytest <chemin> -v`. `asyncio_mode = "auto"` est actif dans `pyproject.toml` (pas besoin de `@pytest.mark.asyncio`). Pas de `conftest.py` : le package est installé en editable (import direct de `mekistudio.*`).
- **Signature du `chat_client_factory` (IMPORTANT) :** la fabrique prend **un seul argument** `options` — `default_client_factory(options)` dans `backend/chat/bridge.py`, et `ChatManager(repo_root, client_factory)`. Les tests existants passent donc `chat_client_factory=lambda o: <client>`. Le **client** retourné expose l'interface `connect(stream)` / `receive()` (async-generator d'events `{"kind": ...}`) / `interrupt()` / `disconnect()` (cf. `tests/unit/test_chat_ws.py`). Pour les tests qui **n'ouvrent pas** de WebSocket, `lambda o: None` suffit (la fabrique n'est jamais appelée).
- **Commits :** la branche par défaut est `main`. Le repo veut « un commit par changement cohérent ». L'utilisateur a demandé des commits ; chaque tâche finit par un commit. **Ne pas pousser** sauf demande.
- **Co-author des commits :** terminer chaque message de commit par la ligne `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Créés (cœur Python, testable sans Docker) :**
- `mekistudio/backend/atomic.py` — helper d'écriture atomique partagé (tmp unique même dossier + `os.replace` + cleanup).
- `mekistudio/backend/routing/__init__.py` — exporte `RouteController`, `Route`, `normalize_host`.
- `mekistudio/backend/routing/host.py` — `normalize_host(raw) -> str | None` (fonction pure).
- `mekistudio/backend/routing/model.py` — modèle Pydantic `Route` + constante `ROUTES_SCHEMA_VERSION`.
- `mekistudio/backend/routing/controller.py` — `RouteController` (RAM + persistance + re-seed).
- `mekistudio/frontend/proxy/__init__.py` — exporte `ProxyDispatch`.
- `mekistudio/frontend/proxy/headers.py` — sanitization des en-têtes hop-by-hop (pures).
- `mekistudio/frontend/proxy/http_tunnel.py` — reverse-proxy HTTP streaming (httpx).
- `mekistudio/frontend/proxy/dispatch.py` — `ProxyDispatch` (callable ASGI : host → studio/tunnel/deny, lifespan passthrough, Origin check).
- `mekistudio/frontend/routes/admin_routes.py` — API REST `/api/routes` (add/remove/list) qui pilote le `RouteController`.
- `docker/Dockerfile` — image multi-stage durcie (studio + CLI claude + tini).
- `docker/entrypoint.sh` — entrypoint (env, `uv tool install --editable`, lancement serve).
- `docker/docker-compose.yml` — socle versionné (port loopback, volumes nommés, bind-mount).
- `.dockerignore` — exclusions de build.
- Tests : `tests/unit/test_atomic.py`, `tests/unit/test_routing_host.py`, `tests/unit/test_routing_model.py`, `tests/unit/test_route_controller.py`, `tests/unit/test_proxy_headers.py`, `tests/unit/test_http_tunnel.py`, `tests/unit/test_proxy_dispatch.py`, `tests/unit/test_admin_routes.py`, `tests/unit/test_proxy_integration.py`, `tests/unit/test_healthz.py`.

**Modifiés :**
- `mekistudio/backend/paths.py` — ajout `routes_path(root)`.
- `mekistudio/frontend/app.py` — `create_app` accepte/expose un `RouteController` + monte l'API admin et `/healthz` ; nouveau `build_asgi_app(...)` qui renvoie l'app enveloppée par `ProxyDispatch`.
- `mekistudio/cli.py` — `serve` lance `build_asgi_app(...)` au lieu de l'app nue + flags uvicorn (`ws_max_size`) ; `_kill` POSIX-friendly.

---

## Task 1: Helper d'écriture atomique partagé

**Files:**
- Create: `mekistudio/backend/atomic.py`
- Test: `tests/unit/test_atomic.py`

**Pourquoi :** le pattern « tmp + rename atomique » est dupliqué (`bootstrap._write_json`, `fs.write_file`). `routes.json` en a besoin ; on extrait un helper unique au lieu d'une 3ᵉ copie. `os.replace` n'est atomique que **sur le même volume** — d'où l'usage d'un tmp dans **le même dossier** que la cible.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_atomic.py
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mekistudio.backend.atomic import atomic_write_text, atomic_write_json


def test_atomic_write_text_creates_and_overwrites(tmp_path: Path):
    target = tmp_path / "sub" / "f.txt"
    target.parent.mkdir()
    atomic_write_text(target, "hello")
    assert target.read_text(encoding="utf-8") == "hello"
    atomic_write_text(target, "world")
    assert target.read_text(encoding="utf-8") == "world"


def test_atomic_write_text_leaves_no_tmp(tmp_path: Path):
    target = tmp_path / "f.txt"
    atomic_write_text(target, "x")
    leftovers = [p.name for p in tmp_path.iterdir() if p.name != "f.txt"]
    assert leftovers == []


def test_atomic_write_json_roundtrip(tmp_path: Path):
    target = tmp_path / "data.json"
    atomic_write_json(target, {"a": 1, "b": [2, 3]})
    assert json.loads(target.read_text(encoding="utf-8")) == {"a": 1, "b": [2, 3]}


def test_atomic_write_json_rejects_nan(tmp_path: Path):
    with pytest.raises(ValueError):
        atomic_write_json(tmp_path / "bad.json", {"x": float("nan")})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_atomic.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mekistudio.backend.atomic'`

- [ ] **Step 3: Write minimal implementation**

```python
# mekistudio/backend/atomic.py
from __future__ import annotations

import json
import uuid
from pathlib import Path


def atomic_write_text(path: Path, text: str) -> None:
    """Écrit `text` atomiquement : fichier temporaire à nom UNIQUE dans LE MÊME
    dossier (os.replace n'est atomique que sur le même volume), puis rename. Un
    crash en cours d'écriture ne laisse jamais la cible tronquée. Nettoyage du
    .tmp si l'écriture/rename échoue (pas de .tmp orphelin)."""
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8", newline="")
        tmp.replace(path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def atomic_write_json(path: Path, payload: object) -> None:
    """Sérialise `payload` en JSON indenté et l'écrit atomiquement. allow_nan=False :
    un NaN/Infinity lève (ValueError) plutôt que de produire du JSON non standard."""
    atomic_write_text(path, json.dumps(payload, indent=2, allow_nan=False))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_atomic.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/backend/atomic.py tests/unit/test_atomic.py
git commit -m "feat(backend): helper d'écriture atomique partagé (atomic.py)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Normalisation du Host (fonction pure)

**Files:**
- Create: `mekistudio/backend/routing/__init__.py`, `mekistudio/backend/routing/host.py`
- Test: `tests/unit/test_routing_host.py`

**Pourquoi :** le routage se fait sur le `Host` ; il faut le normaliser et rejeter les hosts malformés **avant** toute décision (sécurité + stabilité). Fonction pure = facile à tester exhaustivement.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_routing_host.py
from __future__ import annotations

import pytest

from mekistudio.backend.routing.host import normalize_host


@pytest.mark.parametrize("raw,expected", [
    ("mekistudio.localhost", "mekistudio.localhost"),
    ("MekiStudio.LOCALHOST", "mekistudio.localhost"),
    ("webapp.mekistudio.localhost:8777", "webapp.mekistudio.localhost"),
    ("localhost:8777", "localhost"),
    ("127.0.0.1:8777", "127.0.0.1"),
    ("[::1]:8777", "[::1]"),
    ("testserver", "testserver"),
])
def test_normalize_valid(raw, expected):
    assert normalize_host(raw) == expected


@pytest.mark.parametrize("raw", [
    "",            # absent
    None,          # absent
    "a@b.localhost",   # userinfo interdit
    "bad_host\r\n",    # CRLF
    "a..b.localhost",  # label vide
    "x" * 300,         # trop long (>253)
    ("l" * 64) + ".localhost",  # label > 63
])
def test_normalize_rejects(raw):
    assert normalize_host(raw) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_routing_host.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mekistudio.backend.routing'`

- [ ] **Step 3: Write minimal implementation**

```python
# mekistudio/backend/routing/__init__.py
from __future__ import annotations

from mekistudio.backend.routing.host import normalize_host

__all__ = ["normalize_host"]
```

```python
# mekistudio/backend/routing/host.py
from __future__ import annotations

import re

# Label DNS : lettres/chiffres/tiret, 1..63 octets, pas de tiret en début/fin.
_LABEL = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")


def normalize_host(raw: str | None) -> str | None:
    """Normalise un en-tête Host pour le routage, ou renvoie None si invalide.

    - minuscules, port retiré (gère le littéral IPv6 [::1]:p) ;
    - rejette : absent, CR/LF, userinfo (@), longueur > 253, label vide / > 63.
    Le littéral IPv6 entre crochets est accepté tel quel (cas loopback)."""
    if not raw or "\r" in raw or "\n" in raw or "@" in raw:
        return None
    host = raw.strip().lower()

    # Littéral IPv6 : [....] éventuellement suivi de :port -> garder [....]
    if host.startswith("["):
        end = host.find("]")
        if end == -1:
            return None
        return host[: end + 1]

    # Retirer le port (dernier ':') le cas échéant.
    host = host.rpartition(":")[0] or host if ":" in host else host
    if not host or len(host) > 253:
        return None

    # IPv4 loopback / hostnames : valider chaque label.
    labels = host.split(".")
    if any(not _LABEL.match(lbl) for lbl in labels):
        # Tolérer l'IPv4 pure (chiffres + points) que _LABEL accepte déjà ;
        # tout label vide (".." ou bord) échoue ici -> rejet.
        return None
    return host
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_routing_host.py -v`
Expected: PASS (13 passed)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/backend/routing/__init__.py mekistudio/backend/routing/host.py tests/unit/test_routing_host.py
git commit -m "feat(routing): normalize_host (fonction pure, rejette les hosts malformés)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Modèle de route + chemin de persistance

**Files:**
- Create: `mekistudio/backend/routing/model.py`
- Modify: `mekistudio/backend/paths.py` (ajouter `routes_path`)
- Test: `tests/unit/test_routing_model.py`

**Pourquoi :** une route est une donnée typée (Pydantic v2) : host normalisé → endpoint loopback, avec un `service_id` logique découplé de l'endpoint physique (rebind en phase B sans changer l'URL) et un champ `owner` optionnel (frontière tenant, enforcement en phase E). Schéma versionné pour migration future sans casse.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_routing_model.py
from __future__ import annotations

from pathlib import Path

from mekistudio.backend.paths import routes_path
from mekistudio.backend.routing.model import Route, ROUTES_SCHEMA_VERSION


def test_route_endpoint_property():
    r = Route(host="webapp.mekistudio.localhost", service_id="webapp",
              endpoint_host="127.0.0.1", endpoint_port=23322)
    assert r.endpoint == "127.0.0.1:23322"
    assert r.owner is None


def test_route_json_roundtrip():
    r = Route(host="webapp.mekistudio.localhost", service_id="webapp",
              endpoint_host="127.0.0.1", endpoint_port=23322, owner="alice")
    data = r.model_dump(mode="json")
    again = Route.model_validate(data)
    assert again == r
    assert ROUTES_SCHEMA_VERSION >= 1


def test_routes_path(tmp_path: Path):
    assert routes_path(tmp_path) == tmp_path / ".mekistudio" / "routes.json"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_routing_model.py -v`
Expected: FAIL with `ImportError`/`ModuleNotFoundError` (routes_path / model absent)

- [ ] **Step 3: Write minimal implementation**

```python
# mekistudio/backend/routing/model.py
from __future__ import annotations

from pydantic import BaseModel, Field

# Version du schéma persisté dans routes.json (migration future sans casse).
ROUTES_SCHEMA_VERSION = 1


class Route(BaseModel):
    """Une route du reverse-proxy : un host normalisé -> un endpoint loopback.

    `service_id` = identité LOGIQUE stable (l'endpoint physique peut changer en
    phase B sans changer l'URL publique). `owner` = frontière tenant optionnelle
    (inutilisée en phase A solo ; enforcement en phase E)."""

    host: str                       # host normalisé (clé), ex. webapp.mekistudio.localhost
    service_id: str                 # identité logique, ex. "webapp"
    endpoint_host: str = "127.0.0.1"
    endpoint_port: int = Field(ge=1, le=65535)
    owner: str | None = None

    @property
    def endpoint(self) -> str:
        return f"{self.endpoint_host}:{self.endpoint_port}"
```

Ajouter dans `mekistudio/backend/paths.py` (après `canvas_path`) :

```python
def routes_path(root: Path) -> Path:
    return root / MEKI_DIRNAME / "routes.json"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_routing_model.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/backend/routing/model.py mekistudio/backend/paths.py tests/unit/test_routing_model.py
git commit -m "feat(routing): modèle Route (Pydantic) + paths.routes_path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: RouteController (RAM + persistance atomique + re-seed)

**Files:**
- Create: `mekistudio/backend/routing/controller.py`
- Modify: `mekistudio/backend/routing/__init__.py` (exporter `RouteController`, `Route`)
- Test: `tests/unit/test_route_controller.py`

**Pourquoi :** cœur du contrôle de routage. Table en RAM (muter le dict ne coupe aucune WS), projetée atomiquement dans `routes.json`, re-seedée au boot. `upsert_route` idempotent / last-write-wins ; `resolve` renvoie `None` (jamais d'exception) ; fichier illisible au boot → table vide (corrupt-safe, comme le canvas).

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_route_controller.py
from __future__ import annotations

from pathlib import Path

from mekistudio.backend.paths import routes_path
from mekistudio.backend.routing import RouteController, Route


def _meki(tmp_path: Path) -> Path:
    (tmp_path / ".mekistudio").mkdir(parents=True, exist_ok=True)
    return tmp_path


def test_upsert_resolve_and_list(tmp_path: Path):
    rc = RouteController(_meki(tmp_path))
    rc.upsert_route(Route(host="webapp.mekistudio.localhost", service_id="webapp", endpoint_port=23322))
    got = rc.resolve("webapp.mekistudio.localhost")
    assert got is not None and got.endpoint == "127.0.0.1:23322"
    assert [r.host for r in rc.list_routes()] == ["webapp.mekistudio.localhost"]


def test_resolve_unknown_returns_none(tmp_path: Path):
    rc = RouteController(_meki(tmp_path))
    assert rc.resolve("nope.mekistudio.localhost") is None


def test_upsert_is_idempotent_last_write_wins(tmp_path: Path):
    rc = RouteController(_meki(tmp_path))
    rc.upsert_route(Route(host="a.mekistudio.localhost", service_id="a", endpoint_port=1111))
    rc.upsert_route(Route(host="a.mekistudio.localhost", service_id="a", endpoint_port=2222))
    assert len(rc.list_routes()) == 1
    assert rc.resolve("a.mekistudio.localhost").endpoint_port == 2222


def test_remove_route(tmp_path: Path):
    rc = RouteController(_meki(tmp_path))
    rc.upsert_route(Route(host="a.mekistudio.localhost", service_id="a", endpoint_port=1111))
    assert rc.remove_route("a.mekistudio.localhost") is True
    assert rc.resolve("a.mekistudio.localhost") is None
    assert rc.remove_route("a.mekistudio.localhost") is False  # déjà absent


def test_persists_and_reseeds_on_boot(tmp_path: Path):
    root = _meki(tmp_path)
    rc = RouteController(root)
    rc.upsert_route(Route(host="a.mekistudio.localhost", service_id="a", endpoint_port=1234))
    assert routes_path(root).exists()
    rc2 = RouteController(root)  # nouveau contrôleur = re-seed depuis le disque
    assert rc2.resolve("a.mekistudio.localhost").endpoint_port == 1234


def test_corrupt_file_boots_empty(tmp_path: Path):
    root = _meki(tmp_path)
    routes_path(root).write_text("{ pas du json", encoding="utf-8")
    rc = RouteController(root)  # ne lève pas
    assert rc.list_routes() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_route_controller.py -v`
Expected: FAIL with `ImportError: cannot import name 'RouteController'`

- [ ] **Step 3: Write minimal implementation**

```python
# mekistudio/backend/routing/controller.py
from __future__ import annotations

import json
import logging
from pathlib import Path

from mekistudio.backend.atomic import atomic_write_json
from mekistudio.backend.paths import routes_path
from mekistudio.backend.routing.host import normalize_host
from mekistudio.backend.routing.model import ROUTES_SCHEMA_VERSION, Route

log = logging.getLogger(__name__)


class RouteController:
    """Table de routes en RAM, projetée atomiquement dans routes.json, re-seedée
    au boot. Muter le dict ne coupe AUCUNE WebSocket (vs reload Caddy). resolve()
    ne lève jamais ; un fichier illisible au boot -> table vide (corrupt-safe)."""

    def __init__(self, root: Path) -> None:
        self._root = root
        self._routes: dict[str, Route] = {}
        self._load()

    # --- lecture ---
    def resolve(self, host: str | None) -> Route | None:
        key = normalize_host(host)
        if key is None:
            return None
        return self._routes.get(key)

    def list_routes(self) -> list[Route]:
        return sorted(self._routes.values(), key=lambda r: r.host)

    # --- écriture (idempotente, last-write-wins) ---
    def upsert_route(self, route: Route) -> Route:
        key = normalize_host(route.host)
        if key is None:
            raise ValueError(f"host invalide : {route.host!r}")
        stored = route.model_copy(update={"host": key})
        self._routes[key] = stored
        self._save()
        return stored

    def remove_route(self, host: str) -> bool:
        key = normalize_host(host)
        if key is None or key not in self._routes:
            return False
        del self._routes[key]
        self._save()
        return True

    # --- persistance ---
    def _save(self) -> None:
        path = routes_path(self._root)
        # Garantit que .mekistudio/ existe (le flush au shutdown peut tomber avant
        # tout bootstrap, ex. en test) — sinon l'écriture atomique échouerait.
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": ROUTES_SCHEMA_VERSION,
            "routes": [r.model_dump(mode="json") for r in self.list_routes()],
        }
        atomic_write_json(path, payload)

    def _load(self) -> None:
        path = routes_path(self._root)
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for item in data.get("routes", []):
                route = Route.model_validate(item)
                key = normalize_host(route.host)
                if key is not None:
                    self._routes[key] = route.model_copy(update={"host": key})
        except Exception as exc:  # JSON corrompu / schéma invalide
            log.warning("routes.json illisible (%s) — démarrage table vide", exc)
            self._routes = {}
```

Mettre à jour `mekistudio/backend/routing/__init__.py` :

```python
# mekistudio/backend/routing/__init__.py
from __future__ import annotations

from mekistudio.backend.routing.controller import RouteController
from mekistudio.backend.routing.host import normalize_host
from mekistudio.backend.routing.model import ROUTES_SCHEMA_VERSION, Route

__all__ = ["RouteController", "Route", "normalize_host", "ROUTES_SCHEMA_VERSION"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_route_controller.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/backend/routing/controller.py mekistudio/backend/routing/__init__.py tests/unit/test_route_controller.py
git commit -m "feat(routing): RouteController (RAM + persistance atomique + re-seed corrupt-safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Sanitization des en-têtes hop-by-hop (fonctions pures)

**Files:**
- Create: `mekistudio/frontend/proxy/__init__.py`, `mekistudio/frontend/proxy/headers.py`
- Test: `tests/unit/test_proxy_headers.py`

**Pourquoi :** un proxy correct ne forwarde **pas** les en-têtes hop-by-hop (RFC 9112 §9.6) : `Connection`, les champs nommés dans `Connection`, `Keep-Alive`, `Transfer-Encoding`, `TE`, `Trailer`, `Upgrade`, `Proxy-*`. On laisse httpx/uvicorn gérer `Content-Length`/`Transfer-Encoding`. Fonctions pures sur des listes de tuples `(bytes, bytes)` (format ASGI/httpx raw).

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_proxy_headers.py
from __future__ import annotations

from mekistudio.frontend.proxy.headers import strip_hop_by_hop


def test_strips_standard_hop_by_hop():
    headers = [
        (b"host", b"x.localhost"),
        (b"connection", b"keep-alive"),
        (b"keep-alive", b"timeout=5"),
        (b"transfer-encoding", b"chunked"),
        (b"content-type", b"text/html"),
    ]
    out = dict(strip_hop_by_hop(headers))
    assert b"content-type" in out
    assert b"host" in out
    assert b"connection" not in out
    assert b"keep-alive" not in out
    assert b"transfer-encoding" not in out


def test_strips_fields_named_in_connection():
    headers = [
        (b"connection", b"x-custom, close"),
        (b"x-custom", b"secret"),
        (b"content-type", b"text/plain"),
    ]
    out = dict(strip_hop_by_hop(headers))
    assert b"x-custom" not in out          # nommé dans Connection -> retiré
    assert b"content-type" in out


def test_case_insensitive():
    out = dict(strip_hop_by_hop([(b"Connection", b"keep-alive"), (b"Upgrade", b"websocket")]))
    assert out == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_proxy_headers.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mekistudio.frontend.proxy'`

- [ ] **Step 3: Write minimal implementation**

```python
# mekistudio/frontend/proxy/__init__.py
from __future__ import annotations
```

```python
# mekistudio/frontend/proxy/headers.py
from __future__ import annotations

# En-têtes hop-by-hop standard (RFC 9112 §9.6) : ne JAMAIS forwarder.
_HOP_BY_HOP = {
    b"connection", b"keep-alive", b"transfer-encoding", b"te", b"trailer",
    b"upgrade", b"proxy-authorization", b"proxy-authenticate",
}


def strip_hop_by_hop(headers: list[tuple[bytes, bytes]]) -> list[tuple[bytes, bytes]]:
    """Retire les en-têtes hop-by-hop ET tout champ nommé dans `Connection`
    (RFC 9112 §9.6). Entrée/sortie au format ASGI : liste de (nom, valeur) en
    bytes, noms supposés/comparés en minuscules."""
    # Champs additionnels listés dans Connection (ex. "Connection: x-custom").
    extra: set[bytes] = set()
    for name, value in headers:
        if name.lower() == b"connection":
            for token in value.split(b","):
                extra.add(token.strip().lower())
    drop = _HOP_BY_HOP | extra
    return [(n, v) for (n, v) in headers if n.lower() not in drop]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_proxy_headers.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/proxy/__init__.py mekistudio/frontend/proxy/headers.py tests/unit/test_proxy_headers.py
git commit -m "feat(proxy): strip_hop_by_hop (RFC 9112 §9.6, + champs nommés dans Connection)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Tunnel HTTP streaming (httpx)

**Files:**
- Create: `mekistudio/frontend/proxy/http_tunnel.py`
- Test: `tests/unit/test_http_tunnel.py`

**Pourquoi :** forwarder une requête HTTP vers une cible loopback en **streaming** (pas de buffering : on envoie chaque chunk avec `more_body=True`, jamais de `Content-Length` injecté sur du chunké). Testé avec un `httpx.MockTransport` (pas de socket réel) pour valider la traduction ASGI↔httpx.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_http_tunnel.py
from __future__ import annotations

import httpx
import pytest

from mekistudio.frontend.proxy.http_tunnel import forward_http


class _Recorder:
    """Collecte les messages ASGI envoyés par forward_http."""
    def __init__(self):
        self.messages = []
    async def send(self, message):
        self.messages.append(message)


def _scope(path="/hello", query=b"", method="GET"):
    return {
        "type": "http", "method": method, "path": path, "raw_path": path.encode(),
        "query_string": query, "headers": [(b"host", b"webapp.mekistudio.localhost")],
    }


async def _empty_receive():
    return {"type": "http.request", "body": b"", "more_body": False}


async def test_forward_streams_chunks():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "127.0.0.1"
        assert request.url.port == 23322
        assert request.url.path == "/hello"
        return httpx.Response(200, headers={"content-type": "text/plain"}, content=b"chunk-body")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    rec = _Recorder()
    await forward_http(_scope(), _empty_receive, rec.send, client=client, target="127.0.0.1:23322")
    await client.aclose()

    start = rec.messages[0]
    assert start["type"] == "http.response.start"
    assert start["status"] == 200
    body = b"".join(m["body"] for m in rec.messages if m["type"] == "http.response.body")
    assert body == b"chunk-body"
    assert rec.messages[-1]["more_body"] is False


async def test_forward_upstream_unreachable_returns_502():
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    rec = _Recorder()
    await forward_http(_scope(), _empty_receive, rec.send, client=client, target="127.0.0.1:1")
    await client.aclose()
    assert rec.messages[0]["status"] == 502
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_http_tunnel.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mekistudio.frontend.proxy.http_tunnel'`

- [ ] **Step 3: Write minimal implementation**

```python
# mekistudio/frontend/proxy/http_tunnel.py
from __future__ import annotations

import httpx

from mekistudio.frontend.proxy.headers import strip_hop_by_hop


async def _read_body(receive) -> bytes:
    """Agrège le corps de requête ASGI (suffisant en phase A : pas d'upload géant)."""
    body = b""
    while True:
        message = await receive()
        body += message.get("body", b"")
        if not message.get("more_body", False):
            break
    return body


async def forward_http(scope, receive, send, *, client: httpx.AsyncClient, target: str) -> None:
    """Forwarde une requête HTTP ASGI vers `target` (host:port loopback) en
    streaming. Pas de buffering : chaque chunk part avec more_body=True. Upstream
    injoignable -> 502."""
    path = scope.get("raw_path") or scope["path"].encode()
    url = f"http://{target}{path.decode('latin-1')}"
    if scope.get("query_string"):
        url += "?" + scope["query_string"].decode("latin-1")

    req_headers = strip_hop_by_hop(scope["headers"])
    body = await _read_body(receive)
    request = client.build_request(scope["method"], url, headers=req_headers, content=body)

    try:
        response = await client.send(request, stream=True)
    except httpx.HTTPError:
        await send({"type": "http.response.start", "status": 502,
                    "headers": [(b"content-type", b"text/plain; charset=utf-8")]})
        await send({"type": "http.response.body", "body": b"502 Bad Gateway (upstream injoignable)"})
        return

    resp_headers = strip_hop_by_hop(response.headers.raw)
    await send({"type": "http.response.start", "status": response.status_code, "headers": resp_headers})
    try:
        async for chunk in response.aiter_raw():
            await send({"type": "http.response.body", "body": chunk, "more_body": True})
    finally:
        await response.aclose()
    await send({"type": "http.response.body", "body": b"", "more_body": False})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_http_tunnel.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/proxy/http_tunnel.py tests/unit/test_http_tunnel.py
git commit -m "feat(proxy): tunnel HTTP streaming via httpx (more_body, 502 si upstream KO)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Dispatch ASGI (host → studio / tunnel / deny)

**Files:**
- Create: `mekistudio/frontend/proxy/dispatch.py`
- Modify: `mekistudio/frontend/proxy/__init__.py` (exporter `ProxyDispatch`)
- Test: `tests/unit/test_proxy_dispatch.py`

**Pourquoi :** le cœur du proxy. Callable ASGI le plus externe : branche sur `scope['type']` (`lifespan` → forward studio ; `http`/`websocket` → décision sur Host). Host studio → forward in-process vers l'app studio ; route connue → tunnel HTTP ; inconnu → **default-deny** (404 en HTTP, close `1011` en WS). En phase A, un WS vers une route de service est refusé (tunnel WS différé en B).

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_proxy_dispatch.py
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from fastapi.testclient import TestClient

from mekistudio.backend.routing import RouteController, Route
from mekistudio.frontend.proxy import ProxyDispatch


def _studio_app() -> FastAPI:
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return PlainTextResponse("studio-pong")

    return app


def _controller(tmp_path: Path) -> RouteController:
    (tmp_path / ".mekistudio").mkdir(parents=True, exist_ok=True)
    return RouteController(tmp_path)


def test_studio_host_forwards_in_process(tmp_path: Path):
    app = ProxyDispatch(_studio_app(), _controller(tmp_path),
                        studio_hosts={"mekistudio.localhost", "testserver"})
    with TestClient(app) as c:
        r = c.get("/ping")  # TestClient envoie Host: testserver
        assert r.status_code == 200 and r.text == "studio-pong"


def test_unknown_host_default_deny_404(tmp_path: Path):
    app = ProxyDispatch(_studio_app(), _controller(tmp_path),
                        studio_hosts={"mekistudio.localhost"})
    with TestClient(app, base_url="http://evil.localhost") as c:
        r = c.get("/ping")
        assert r.status_code == 404


def test_known_route_tunnels(tmp_path: Path):
    rc = _controller(tmp_path)
    # Endpoint inexistant -> le tunnel renverra 502, ce qui PROUVE qu'on a tunnelé
    # (et pas servi le studio ni 404).
    rc.upsert_route(Route(host="webapp.mekistudio.localhost", service_id="webapp", endpoint_port=9))
    app = ProxyDispatch(_studio_app(), rc, studio_hosts={"mekistudio.localhost"})
    with TestClient(app, base_url="http://webapp.mekistudio.localhost") as c:
        r = c.get("/anything")
        assert r.status_code == 502
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_proxy_dispatch.py -v`
Expected: FAIL with `ImportError: cannot import name 'ProxyDispatch'`

- [ ] **Step 3: Write minimal implementation**

```python
# mekistudio/frontend/proxy/dispatch.py
from __future__ import annotations

import httpx

from mekistudio.backend.routing import RouteController
from mekistudio.frontend.proxy.http_tunnel import forward_http

# Hosts servis par le studio lui-même (en plus de toute route enregistrée).
DEFAULT_STUDIO_HOSTS = {"mekistudio.localhost", "localhost", "127.0.0.1", "[::1]"}


def _host_from_scope(scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name.lower() == b"host":
            return value.decode("latin-1")
    return None


class ProxyDispatch:
    """Callable ASGI le plus externe : route par Host.

    - lifespan -> forward à l'app studio (sa startup/shutdown doit tourner) ;
    - http/websocket : host studio -> forward in-process ; route connue -> tunnel
      (HTTP en phase A) ; inconnu -> default-deny (404 / close 1011)."""

    def __init__(self, studio_app, controller: RouteController, *,
                 studio_hosts: set[str] | None = None) -> None:
        self._studio = studio_app
        self._controller = controller
        self._studio_hosts = studio_hosts or set(DEFAULT_STUDIO_HOSTS)
        self._client: httpx.AsyncClient | None = None

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "lifespan":
            await self._handle_lifespan(scope, receive, send)
            return

        from mekistudio.backend.routing import normalize_host
        host = normalize_host(_host_from_scope(scope))

        # 1) route de service connue -> tunnel
        route = self._controller.resolve(host) if host else None
        if route is not None:
            if scope["type"] == "websocket":
                await _deny_ws(send, "Tunnel WebSocket non supporté en phase A")
                return
            await forward_http(scope, receive, send, client=self._ensure_client(), target=route.endpoint)
            return

        # 2) host studio -> forward in-process
        if host in self._studio_hosts:
            await self._studio(scope, receive, send)
            return

        # 3) inconnu -> default-deny
        if scope["type"] == "websocket":
            await _deny_ws(send, "Host inconnu")
        else:
            await _deny_http(send)

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            # connect timeout court ; pas de timeout de lecture (streaming long).
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=None, write=None, pool=None))
        return self._client

    async def _handle_lifespan(self, scope, receive, send) -> None:
        # On délègue le lifespan à l'app studio, mais on ferme aussi notre client httpx.
        async def _send_wrapper(message):
            if message["type"] == "lifespan.shutdown.complete" and self._client is not None:
                await self._client.aclose()
                self._client = None
            await send(message)
        await self._studio(scope, receive, _send_wrapper)


async def _deny_http(send) -> None:
    await send({"type": "http.response.start", "status": 404,
                "headers": [(b"content-type", b"text/plain; charset=utf-8")]})
    await send({"type": "http.response.body", "body": b"404 Unknown host (default-deny)"})


async def _deny_ws(send, reason: str) -> None:
    # Refuser AVANT accept = handshake rejeté ; sinon close 1011.
    await send({"type": "websocket.close", "code": 1011})
```

Mettre à jour `mekistudio/frontend/proxy/__init__.py` :

```python
# mekistudio/frontend/proxy/__init__.py
from __future__ import annotations

from mekistudio.frontend.proxy.dispatch import ProxyDispatch, DEFAULT_STUDIO_HOSTS

__all__ = ["ProxyDispatch", "DEFAULT_STUDIO_HOSTS"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_proxy_dispatch.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/proxy/dispatch.py mekistudio/frontend/proxy/__init__.py tests/unit/test_proxy_dispatch.py
git commit -m "feat(proxy): ProxyDispatch ASGI (host -> studio/tunnel/deny, lifespan passthrough)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: API admin /api/routes (ajout/retrait à chaud) + câblage du controller

**Files:**
- Create: `mekistudio/frontend/routes/admin_routes.py`
- Modify: `mekistudio/frontend/app.py` (créer/exposer le `RouteController`, monter l'API admin)
- Test: `tests/unit/test_admin_routes.py`

**Pourquoi :** mécanisme d'« ajout de route à chaud » de la DoD. Une API REST sur le studio (`POST/GET/DELETE /api/routes`) qui mute le `RouteController` partagé. C'est ce que l'UI (ou un curl de test) appellera.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_admin_routes.py
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from mekistudio.frontend.app import create_app


def _client(tmp_path: Path) -> TestClient:
    # La fabrique prend UN seul arg (options) ; ici aucun WS n'est ouvert -> jamais appelée.
    app = create_app(repo_root=tmp_path, chat_client_factory=lambda o: None)
    return TestClient(app)


def test_post_then_get_routes(tmp_path: Path):
    with _client(tmp_path) as c:
        r = c.post("/api/routes", json={
            "host": "webapp.mekistudio.localhost", "service_id": "webapp", "endpoint_port": 23322,
        })
        assert r.status_code == 201
        body = c.get("/api/routes").json()
        assert any(item["host"] == "webapp.mekistudio.localhost" for item in body["routes"])


def test_post_invalid_host_rejected(tmp_path: Path):
    with _client(tmp_path) as c:
        r = c.post("/api/routes", json={"host": "bad_host\n", "service_id": "x", "endpoint_port": 1})
        assert r.status_code == 422


def test_delete_route(tmp_path: Path):
    with _client(tmp_path) as c:
        c.post("/api/routes", json={"host": "a.mekistudio.localhost", "service_id": "a", "endpoint_port": 1})
        r = c.delete("/api/routes/a.mekistudio.localhost")
        assert r.status_code == 204
        body = c.get("/api/routes").json()
        assert body["routes"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_admin_routes.py -v`
Expected: FAIL (404 sur `/api/routes` : router non monté)

- [ ] **Step 3: Write minimal implementation**

```python
# mekistudio/frontend/routes/admin_routes.py
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from mekistudio.backend.routing import Route
from mekistudio.backend.routing.host import normalize_host

router = APIRouter(prefix="/api/routes", tags=["routes"])


class RouteIn(BaseModel):
    host: str
    service_id: str
    endpoint_host: str = "127.0.0.1"
    endpoint_port: int = Field(ge=1, le=65535)
    owner: str | None = None


@router.get("")
def list_routes(request: Request) -> dict:
    rc = request.app.state.route_controller
    return {"routes": [r.model_dump(mode="json") for r in rc.list_routes()]}


@router.post("", status_code=201)
def add_route(payload: RouteIn, request: Request) -> dict:
    if normalize_host(payload.host) is None:
        raise HTTPException(status_code=422, detail="host invalide")
    rc = request.app.state.route_controller
    stored = rc.upsert_route(Route(**payload.model_dump()))
    return stored.model_dump(mode="json")


@router.delete("/{host}", status_code=204)
def remove_route(host: str, request: Request) -> Response:
    rc = request.app.state.route_controller
    if not rc.remove_route(host):
        raise HTTPException(status_code=404, detail="route inconnue")
    return Response(status_code=204)
```

Dans `mekistudio/frontend/app.py`, modifier `create_app` pour créer/exposer le controller et monter le router. Ajouter l'import en tête :

```python
from mekistudio.backend.routing import RouteController
from mekistudio.frontend.routes import admin_routes
```

Et dans `create_app`, après la ligne `app.state.chat_manager = ChatManager(...)`, ajouter :

```python
    app.state.route_controller = RouteController(repo_root)
```

puis, à côté des autres `app.include_router(...)`, ajouter :

```python
    app.include_router(admin_routes.router)
```

(Note : le `chat_client_factory=lambda o: None` du test ne crée pas de vrai client ; aucun WS n'est ouvert dans ce test, donc c'est sans effet.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_admin_routes.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/routes/admin_routes.py mekistudio/frontend/app.py tests/unit/test_admin_routes.py
git commit -m "feat(api): /api/routes (add/list/remove à chaud) + RouteController sur app.state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Envelopper l'app avec le proxy + câbler la CLI

**Files:**
- Modify: `mekistudio/frontend/app.py` (ajouter `build_asgi_app`)
- Modify: `mekistudio/cli.py` (`serve` lance l'app enveloppée + `ws_max_size` ; `_kill` POSIX)
- Modify (conditionnel) : `tests/unit/test_cli.py` (seulement si un test casse — voir Step 3b)
- Test: `tests/unit/test_build_asgi_app.py` (Create)

**Note compat tests :** `tests/unit/test_cli.py` monkeypatche `uvicorn.run` avec `lambda *a, **k: ...` (variadique) — l'ajout du kwarg `ws_max_size=` est donc **absorbé sans modification** (vérifié dans le code réel). Step 3b ne fait que confirmer ce point.

**Pourquoi :** assembler le tout. `create_app` continue de renvoyer l'app FastAPI studio (les tests existants ne cassent pas) ; `build_asgi_app` renvoie l'app **enveloppée** par `ProxyDispatch`. La CLI sert l'app enveloppée. On borne aussi la taille des messages WS (anti-DoS) et on rend `_kill` utilisable dans un conteneur Linux (pas seulement `taskkill`).

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_build_asgi_app.py
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from mekistudio.frontend.app import build_asgi_app


def test_build_asgi_app_serves_studio_and_denies_unknown(tmp_path: Path):
    app = build_asgi_app(repo_root=tmp_path, chat_client_factory=lambda o: None)
    # Host studio -> l'API admin du studio répond.
    with TestClient(app, base_url="http://mekistudio.localhost") as c:
        assert c.get("/api/routes").status_code == 200
    # Host inconnu -> default-deny.
    with TestClient(app, base_url="http://evil.localhost") as c:
        assert c.get("/api/routes").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_build_asgi_app.py -v`
Expected: FAIL with `ImportError: cannot import name 'build_asgi_app'`

- [ ] **Step 3: Write minimal implementation**

Ajouter à la fin de `mekistudio/frontend/app.py` :

```python
def build_asgi_app(repo_root: Path | None = None, *, chat_client_factory=None):
    """App ASGI complète = app studio enveloppée par le reverse-proxy (ProxyDispatch).
    C'est ce que sert la CLI ; create_app reste l'app studio nue (tests/réutilisation)."""
    from mekistudio.frontend.proxy import ProxyDispatch

    studio = create_app(repo_root=repo_root, chat_client_factory=chat_client_factory)
    return ProxyDispatch(studio, studio.state.route_controller)
```

Dans `mekistudio/cli.py`, modifier l'appel uvicorn de `serve` (ligne `uvicorn.run(create_app(repo_root=root), host=host, port=port)`) en :

```python
    from mekistudio.frontend.app import build_asgi_app

    # On sert l'app ENVELOPPÉE (proxy + studio). ws_max_size borne les messages WS
    # (anti-DoS mémoire). host=127.0.0.1 : le proxy est co-localisé dans le process.
    uvicorn.run(
        build_asgi_app(repo_root=root),
        host=host,
        port=port,
        ws_max_size=4 * 1024 * 1024,
    )
```

(Supprimer l'ancien import inline `from mekistudio.frontend.app import create_app` de `serve` s'il existe, et le remplacer par l'import de `build_asgi_app` ci-dessus.)

Toujours dans `mekistudio/cli.py`, rendre `_kill` utilisable hors Windows (le conteneur est Linux) — remplacer le corps de `_kill` par :

```python
def _kill(pid: int) -> None:
    """Termine le process `pid`. Windows : taskkill (tue l'arbre). POSIX/conteneur :
    SIGTERM (le process gère son arrêt gracieux)."""
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(pid), "/F", "/T"], capture_output=True)
    else:
        import signal
        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
```

(Si ce corps est déjà présent à l'identique, ne rien changer.)

- [ ] **Step 3b: Vérifier la compat de `tests/unit/test_cli.py` avec le nouveau kwarg**

`tests/unit/test_cli.py` monkeypatche `uvicorn.run` avec `lambda *a, **k: ...` (déjà variadique, vérifié dans le code réel) — le kwarg `ws_max_size` est donc **absorbé sans modification**. **Ne modifie ce fichier que si** un test échoue réellement avec `TypeError: ... unexpected keyword argument 'ws_max_size'` ; dans ce cas seulement, élargir la fonction/lambda fautive avec `**kwargs`. Sinon, ne touche pas à `test_cli.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_build_asgi_app.py tests/unit/test_cli.py -v`
Expected: PASS (test_build_asgi_app : 1 passed ; test_cli : tous les tests existants passent — la lambda `*a, **k` absorbe `ws_max_size`)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/app.py mekistudio/cli.py tests/unit/test_build_asgi_app.py
git commit -m "feat: build_asgi_app (studio + proxy) servie par la CLI + ws_max_size + _kill POSIX

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Test d'intégration DoD — ajout de route pendant un streaming WS (zéro coupure)

**Files:**
- Test: `tests/unit/test_proxy_integration.py`

**Pourquoi :** c'est **le** test qui prouve la raison d'être de la fondation A : ajouter une route (HTTP) à chaud pendant qu'une session chat WebSocket streame **ne coupe pas** le WS. On le valide in-process via `TestClient` sur l'app enveloppée, avec un **faux client chat identique à celui de `test_chat_ws.py`** (interface `connect/receive/interrupt/disconnect`) ; l'ajout de route passe par l'API admin. On reçoit au moins un `text_delta`, on POST la route, puis on continue jusqu'à `message_stop` — preuve que le WS n'a pas été coupé par l'ajout de route.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_proxy_integration.py
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from mekistudio.frontend.app import build_asgi_app


class _StreamingClient:
    """Faux client SDK (même interface que dans test_chat_ws.py) : émet un tour
    texte à chaque prompt reçu dans le stream."""

    def __init__(self, *_):
        self._stream = None

    async def connect(self, stream):
        self._stream = stream

    async def receive(self):
        async for _msg in self._stream:
            yield {"kind": "message_start"}
            yield {"kind": "delta", "text": "a"}
            yield {"kind": "delta", "text": "b"}
            yield {"kind": "assistant", "text": "ab"}
            yield {"kind": "result", "subtype": "success", "session_id": "sid"}

    async def interrupt(self):
        ...

    async def disconnect(self):
        ...


def test_add_route_during_ws_stream_does_not_cut(tmp_path: Path):
    # build_asgi_app enveloppe l'app studio par le proxy ; on cible le host studio.
    app = build_asgi_app(repo_root=tmp_path, chat_client_factory=lambda o: _StreamingClient())
    with TestClient(app, base_url="http://mekistudio.localhost") as c:
        with c.websocket_connect("/ws/chat/conv-int") as ws:
            ws.send_json({"type": "attach", "since_seq": 0})
            ws.send_json({"type": "prompt", "text": "go"})

            # Recevoir le 1er text_delta...
            first = ws.receive_json()
            while first.get("type") != "text_delta":
                first = ws.receive_json()

            # ...AJOUTER une route à chaud PENDANT le stream (via l'API admin)...
            r = c.post("/api/routes", json={
                "host": "webapp.mekistudio.localhost", "service_id": "webapp", "endpoint_port": 23322,
            })
            assert r.status_code == 201

            # ...le WS continue de streamer jusqu'à message_stop, SANS coupure.
            types = [first["type"]]
            for _ in range(30):
                msg = ws.receive_json()
                types.append(msg["type"])
                if msg["type"] == "message_stop":
                    break
            # message_stop reçu APRÈS le POST de route => le WS n'a pas été coupé.
            assert "message_stop" in types
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_proxy_integration.py -v`
Expected: au pire FAIL si un détail de wiring manque ; sinon PASS. (Si FAIL, corriger le wiring des tâches 7–9 jusqu'au PASS — ce test ne doit PAS être affaibli.)

- [ ] **Step 3: (pas de nouveau code)**

Ce test valide le comportement déjà implémenté. S'il échoue, le bug est dans le dispatch (Task 7) ou le wiring (Task 9), pas dans le test.

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest -q`
Expected: PASS (toute la suite, y compris les tests existants `test_chat_ws.py`, `test_cli.py`, etc.)

- [ ] **Step 5: Commit**

```bash
git add tests/unit/test_proxy_integration.py
git commit -m "test(proxy): DoD — ajout de route à chaud pendant un stream WS ne coupe pas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: /healthz + arrêt gracieux (flush des routes)

**Files:**
- Modify: `mekistudio/frontend/app.py` (`/healthz` + flush des routes au shutdown via lifespan)
- Test: `tests/unit/test_healthz.py`

**Pourquoi :** `HEALTHCHECK` Docker a besoin d'un endpoint léger **indépendant de la table de routes**. Et au shutdown (SIGTERM, fréquent avec `update --restart`), on **flush** les routes sur disque (drain lame-duck minimal en phase A : la persistance est déjà faite à chaque mutation, mais on garantit un flush final).

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_healthz.py
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from mekistudio.frontend.app import create_app


def test_healthz_ok(tmp_path: Path):
    app = create_app(repo_root=tmp_path, chat_client_factory=lambda o: None)
    with TestClient(app) as c:
        r = c.get("/healthz")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_healthz.py -v`
Expected: FAIL (404 sur `/healthz`)

- [ ] **Step 3: Write minimal implementation**

Dans `mekistudio/frontend/app.py`, dans `create_app`, après les `include_router`, ajouter une route légère :

```python
    @app.get("/healthz")
    def healthz() -> dict:
        # Léger et INDÉPENDANT de la table de routes (sonde Docker).
        return {"status": "ok"}
```

Et renforcer le `_lifespan` pour flusher les routes à l'arrêt. Remplacer le corps de `_lifespan` par :

```python
@asynccontextmanager
async def _lifespan(app: FastAPI):
    try:
        yield
    finally:
        # Arrêt gracieux : flush final des routes (idempotent — déjà persistées à
        # chaque mutation) puis arrêt propre des sessions Claude.
        controller = getattr(app.state, "route_controller", None)
        if controller is not None:
            controller.flush()
        await app.state.chat_manager.shutdown()
```

Ajouter une méthode `flush()` publique au `RouteController` (dans `mekistudio/backend/routing/controller.py`), qui réécrit l'état courant :

```python
    def flush(self) -> None:
        """Réécrit routes.json depuis l'état RAM (flush idempotent à l'arrêt)."""
        self._save()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/test_healthz.py tests/unit/test_route_controller.py -v`
Expected: PASS (healthz : 1 passed ; route_controller : 6 passed)

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/app.py mekistudio/backend/routing/controller.py tests/unit/test_healthz.py
git commit -m "feat: /healthz (sonde Docker) + flush des routes à l'arrêt gracieux

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Packaging Docker (image durcie + compose + entrypoint)

**Files:**
- Create: `docker/Dockerfile`, `docker/entrypoint.sh`, `docker/docker-compose.yml`, `.dockerignore`

**Pourquoi :** la frontière conteneur EST l'isolation. Image multi-stage, **non-root**, PID1 init (`--init` côté run), `claude` CLI embarqué, bind-mount du code, volumes nommés pour `~/.claude` et `.mekistudio/`, **un seul port publié sur loopback**. Pas de test pytest ici (artefacts d'infra) ; la validation est manuelle en Task 13.

- [ ] **Step 1: Créer `.dockerignore`**

```
.git
.venv
__pycache__
*.pyc
.superpowers
.mekistudio
docs/raw
node_modules
.pytest_cache
```

- [ ] **Step 2: Créer `docker/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
# --- Stage build : récupère uv et installe les deps ---
FROM python:3.11-slim AS build
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml README.md ./
COPY mekistudio ./mekistudio
# Installe le package + ses deps dans un venv autonome.
RUN uv venv /opt/venv \
 && VIRTUAL_ENV=/opt/venv uv pip install --no-cache .

# --- Stage runtime : minimal, non-root, claude CLI ---
FROM python:3.11-slim AS runtime
# Node.js + claude CLI (le SDK shell-out vers `claude`). tini = PID1 (signaux).
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm tini ca-certificates \
 && npm install -g @anthropic-ai/claude-code \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
# Utilisateur non-root.
RUN useradd --create-home --uid 1000 meki
COPY --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    MEKISTUDIO_REPO_ROOT=/workspace
COPY docker/entrypoint.sh /usr/local/bin/meki-entrypoint
RUN chmod +x /usr/local/bin/meki-entrypoint
USER meki
WORKDIR /workspace
EXPOSE 8777
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8777/healthz', timeout=2).status==200 else 1)"]
ENTRYPOINT ["/usr/sbin/tini", "--", "/usr/local/bin/meki-entrypoint"]
```

- [ ] **Step 3: Créer `docker/entrypoint.sh`**

```bash
#!/usr/bin/env sh
set -e
# Le code est bind-monté sur /workspace ; on (ré)installe le package en editable
# pour que le code live du repo soit lu directement (boucle dev).
if [ -f /workspace/pyproject.toml ]; then
  uv pip install --python /opt/venv/bin/python -e /workspace >/dev/null 2>&1 || true
fi
# host=0.0.0.0 DANS le conteneur : le port 8777 est publié uniquement sur le
# loopback de l'hôte (voir compose), donc pas d'exposition réseau élargie.
exec mekistudio serve --no-open --host 0.0.0.0 --port 8777
```

- [ ] **Step 4: Créer `docker/docker-compose.yml`**

```yaml
# Socle FIXE versionné de la Fondation A (source de vérité du conteneur studio).
services:
  studio:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    init: true                       # PID1 = init (propagation des signaux)
    ports:
      - "127.0.0.1:8777:8777"        # UN SEUL port, publié sur le loopback hôte
    volumes:
      - ..:/workspace                # bind-mount du repo (boucle dev)
      - meki_state:/workspace/.mekistudio   # état (routes.json, conversations) sur volume nommé
      - claude_auth:/home/meki/.claude      # auth Claude persistée
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}   # injecté au runtime, jamais dans l'image
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 512
    mem_limit: 2g

volumes:
  meki_state:
  claude_auth:
```

- [ ] **Step 5: Commit**

```bash
git add docker/Dockerfile docker/entrypoint.sh docker/docker-compose.yml .dockerignore
git commit -m "feat(docker): image multi-stage durcie + compose (1 port loopback, volumes nommés)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Validation DoD manuelle (Docker + navigateur) + mise à jour docs

**Files:**
- Modify: `docs/ROADMAP.md` (#7 : isolation promue/livrée en A), `CLAUDE.md` (note « pur Python DANS Docker »)
- Create: `docs/fondation-a-validation.md` (checklist de validation reproductible)

**Pourquoi :** la DoD inclut une preuve **bout-en-bout réelle** (conteneur + navigateur Windows) que pytest in-process ne couvre pas (résolution `*.localhost` par le navigateur). On documente une checklist reproductible et on aligne la doc projet.

- [ ] **Step 1: Créer `docs/fondation-a-validation.md`**

````markdown
# Fondation A — checklist de validation (manuelle, reproductible)

Prérequis : Docker Desktop (backend WSL2) démarré ; `ANTHROPIC_API_KEY` dans l'environnement.

1. **Build + run**
   ```bash
   cd C:/mekistudio
   docker compose -f docker/docker-compose.yml up --build -d
   docker compose -f docker/docker-compose.yml ps   # studio = healthy
   ```
2. **Studio accessible** (navigateur Windows) : ouvrir `http://mekistudio.localhost:8777/`
   → le canvas s'affiche. (Chrome/Edge/Firefox résolvent `*.localhost` sans toucher au fichier hosts.)
3. **Lancer un dev-server bidon DANS le conteneur** (port interne 23322) :
   ```bash
   docker compose -f docker/docker-compose.yml exec studio \
     python -c "import http.server,socketserver; socketserver.TCPServer(('127.0.0.1',23322), http.server.SimpleHTTPRequestHandler).serve_forever()" &
   ```
4. **Ajouter la route à chaud** (depuis l'hôte, via l'API admin, en ciblant le studio) :
   ```bash
   curl -s -X POST http://mekistudio.localhost:8777/api/routes \
     -H "Content-Type: application/json" \
     -d '{"host":"webapp.mekistudio.localhost","service_id":"webapp","endpoint_port":23322}'
   ```
   *(Si `curl` sur Windows ne résout pas `*.localhost`, utiliser `curl --resolve webapp.mekistudio.localhost:8777:127.0.0.1 ...` ou cibler `http://localhost:8777/api/routes`.)*
5. **Tester le nouveau service** (navigateur Windows) : ouvrir
   `http://webapp.mekistudio.localhost:8777/` → la page du dev-server bidon s'affiche.
   **Aucun port autre que 8777 n'a été ouvert.**
6. **Preuve « zéro coupure WS »** (Playwright, conforme à la mémoire projet) : ouvrir le chat,
   lancer une génération, ajouter/retirer une route pendant le stream, vérifier (screenshot +
   console) que le chat continue sans coupure. (Le test in-process `test_proxy_integration.py`
   couvre déjà la logique ; cette étape valide le chemin navigateur réel.)
7. **Teardown**
   ```bash
   docker compose -f docker/docker-compose.yml down
   ```
````

- [ ] **Step 2: Mettre à jour `docs/ROADMAP.md`**

Remplacer la ligne 7 de la liste « Reste à faire » :

```
7. **Plus tard / optionnel** : sandbox Docker + Traefik (mis de côté). Réf :
   `docs/old/mekistudio/07-sandbox-docker.md`.
```

par :

```
7. **Isolation conteneur (Fondation A)** — ✅ studio conteneurisé + reverse-proxy
   Python mono-port (routes à chaud, 0 WS coupée). Réf : `docs/superpowers/specs/
   2026-05-31-fondation-a-studio-conteneurise-design.md` + north-star. Suite : B
   (control plane multi-repos), C (cloud), D (multiplayer), E (multi-tenant).
```

- [ ] **Step 3: Mettre à jour `CLAUDE.md`**

Dans la 1ʳᵉ phrase, après « sans Docker », ajouter une note de nuance. Remplacer :

```
AI dev studio en **pur Python, sans Docker, auto-hébergé**
```

par :

```
AI dev studio en **pur Python, auto-hébergé** (cœur sans dépendance Docker ; l'**isolation**
runtime — Fondation A — fait tourner le studio *dans* un conteneur, cf. north-star)
```

- [ ] **Step 4: Vérifier la suite complète une dernière fois**

Run: `python -m pytest -q`
Expected: PASS (toute la suite).

- [ ] **Step 5: Commit**

```bash
git add docs/fondation-a-validation.md docs/ROADMAP.md CLAUDE.md
git commit -m "docs(fondation-a): checklist de validation + ROADMAP #7 livré + note pur-Python-dans-Docker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes finales pour l'exécutant

- **Ordre des tâches = ordre des dépendances.** 1→11 sont du Python pur testable sans Docker ; 12–13 packagent et valident. Ne pas réordonner.
- **Si un test « should fail » passe déjà**, c'est que le module existe d'une exécution précédente — vérifier l'état git avant de continuer.
- **Layering :** si tu te surprends à importer `mekistudio.frontend` depuis `mekistudio.backend`, tu as fait une erreur — le `RouteController` et le modèle sont backend, le proxy est frontend.
- **Nouvelle dépendance ?** Il ne devrait pas y en avoir. Si jamais, rappel mémoire projet : `uv add` ne suffit pas pour l'outil global — refaire `uv tool install --editable . --force` (studio arrêté).
- **WS tunnel upstream (phase B) :** quand tu l'implémenteras, le point d'extension est `ProxyDispatch.__call__` branche `scope['type'] == 'websocket'` + route connue (actuellement `_deny_ws`).
```
