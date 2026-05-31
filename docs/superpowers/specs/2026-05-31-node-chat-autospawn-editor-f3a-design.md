# Node chat — auto-spawn d'éditeur (brique F, Spec 2 / F3a : cœur éphémère)

> **Statut** : design validé (brainstorming 2026-05-31). Brique **F** = 2 specs : F1+F2 (livré) et F3
> (auto-spawn). F3 lui-même = 2 étapes : **F3a** (ce doc, le cœur : spawn éphémère) et **F3b** (réglages
> configurables : modale du chat, modes plafond/illimité). F3a ship avec le mode **éphémère** par
> défaut et des constantes (TTL 10 min, plafond 20) ; F3b les rendra éditables.

## 1. Contexte

Brique F1+F2 (livré) : les hooks/tool_results déclenchent des impulsions. Aujourd'hui, lire un fichier
**déjà ouvert** dans un éditeur → comète chat→éditeur + glow ; lire un fichier **non ouvert** → comète
de repli vers l'explorateur. F3a remplace ce cas de repli par : **spawn d'un éditeur du fichier lu** —
« les lectures de Claude matérialisent les fichiers sur le canvas ». Décidé au brainstorming :
- L'éditeur apparaît **près de l'explorateur**, `source_id = explorateur` (comme un éditeur ouvert à la
  main via `openFileInNewEditor`). La comète parcourt chat→explorateur→éditeur ; l'éditeur **apparaît à
  l'arrivée** de la comète (fade-in + glow).
- **Éphémère par défaut** : l'éditeur est **persisté** (`canvas.json`) avec un flag, et **auto-supprimé**
  après le TTL (10 min). Il **survit à un reload** (jusqu'au TTL). **Clic sur le node = épingle** → il
  devient permanent. **Dedup par fichier** : relire un fichier déjà spawné → comète vers lui (pas de
  doublon), TTL ré-armé. **Plafond 20** auto-spawnés vivants (au-delà, le plus ancien éphémère se ferme).

## 2. Objectifs / non-objectifs

**Objectifs (F3a)** — lecture d'un fichier non ouvert → **spawn d'un éditeur** (comète + fade-in à
l'arrivée) ; éditeur **éphémère persisté** (`Node.ephemeral` + `Node.expires_at_ms`), auto-supprimé au
TTL (front), nettoyé au chargement (serveur) ; **épingle au clic** (devient permanent) ; **dedup** par
fichier (+ ré-armement TTL) ; **plafond 20**. Constantes côté front (TTL 10 min, cap 20).

**Non-objectifs** — **modale de réglages** du chat + modes **plafond/illimité** configurables (= **F3b**) ;
auto-spawn sur **Edit/Write** (les outils d'écriture arrivent avec la brique **Docker**) ; animation
« trace le câble progressivement » sophistiquée (on fait fade-in à l'arrivée de la comète — suffisant).

## 3. Exigences

| # | Exigence | Détail |
|---|----------|--------|
| F3a.1 | **Modèle node** | `Node` (`backend/models.py`) gagne `ephemeral: bool = False` et `expires_at_ms: int \| None = None`. Persistés dans `canvas.json` (rétro-compat : défauts pour les nodes existants). |
| F3a.2 | **Création** | `NodeCreate` accepte `ephemeral` + `expires_at_ms` ; `create_node` les pose sur le node après `build_node`. Le reste (source_id dérivé = explorateur pour `fileeditor`, `MAX_NODES`) inchangé. |
| F3a.3 | **Épingle** | Nouvel endpoint `POST /api/canvas/nodes/{id}/pin` → `ephemeral=False`, `expires_at_ms=None`, persiste. Renvoie le node. |
| F3a.4 | **Nettoyage au chargement** | `GET /api/canvas` retire les nodes `ephemeral` dont `expires_at_ms < now_ms()` **avant** de répondre (sauve si modifié). Évite la résurrection d'aperçus expirés après un redémarrage serveur / reload. |
| F3a.5 | **Trigger front** | Dans `canvas.js applyIntent`, une intention comète `target.by==='file'` SANS éditeur correspondant (`editorIdForFile` null) → `spawnEphemeralEditor(filePath)` **au lieu** du repli explorateur. (Le module pur `chat-impulses` est inchangé.) |
| F3a.6 | **Spawn** | `spawnEphemeralEditor(path)` : (a) **dedup** (`editorIdForFile` — si déjà là, comète vers lui + ré-arme son TTL, fin) ; (b) **plafond** : si ≥ 20 auto-spawnés vivants, fermer le plus ancien éphémère ; (c) `POST /api/canvas/nodes {kind:'fileeditor', x, y (editorSpawnPos), ephemeral:true, expires_at_ms: now+TTL}` + `POST .../open {path}` (rollback `DELETE` si l'ouverture échoue) ; (d) `renderNode` en **fade-in** (classe `ephemeral`), `drawCables` ; (e) **comète** chat→nouvel éditeur (`pulseTo`), l'éditeur **devient visible** + glow à l'arrivée ; (f) **timer TTL** (`setTimeout` → `DELETE`), mémorisé par id. |
| F3a.7 | **Timers au chargement** | `renderNodes` : pour chaque node `ephemeral` reçu, armer un timer `expires_at_ms - now` → `DELETE` (et style `ephemeral`). Si déjà expiré (course avec F3a.4), `DELETE` immédiat. |
| F3a.8 | **Épingle au clic** | Cliquer un node éditeur `ephemeral` → `POST .../pin`, annule le timer TTL, retire la classe `ephemeral`, marque le node permanent. (Listener capture, retiré ensuite — pas de fuite.) |
| F3a.9 | **Style éphémère** | `.node-wrap.ephemeral` : bordure pointillée + légère transparence (signale « aperçu »). Retiré à l'épingle. Fade-in à l'apparition. |

## 4. Flux

```
tool_result(Read/Grep, fichier X non ouvert) [F1+F2]
  -> chat-impulses.impulseFor -> intent comète by:file X (fallback explorateur)
  -> canvas.applyIntent : editorIdForFile(X) == null ET intent.target.by==='file'
       -> spawnEphemeralEditor(X) :
            dedup ? -> comète + ré-arme TTL
            sinon -> [plafond] -> POST create(ephemeral, expires_at) + open -> renderNode(fade-in)
                     -> pulseTo(chat -> nouvel éditeur) -> visible + glow -> setTimeout(TTL -> DELETE)
  clic sur le node éphémère -> POST pin -> permanent (timer annulé, style retiré)
  reload -> GET /api/canvas (purge les expirés) -> renderNodes arme les timers restants
```

## 5. Constantes (F3a ; configurables en F3b)

`SPAWN_TTL_MS = 10 * 60 * 1000` (10 min) · `SPAWN_CAP = 20` (auto-spawnés vivants max). Côté front
(`canvas.js`). En F3b elles viendront des réglages du `ChatComponent`.

## 6. Risques / points durs

- **Course dedup/plafond en rafale** : plusieurs lectures simultanées du MÊME fichier non ouvert →
  risque de double spawn. Mitigation : réserver le chemin en cours de spawn (set `_spawning` par
  `path`, comme `_pendingSpots` pour les positions) — un 2ᵉ trigger sur un path en cours est ignoré
  (ou rattaché à la comète en vol).
- **TTL ré-armé non re-persisté** : au dedup, on ré-arme le timer FRONT mais on ne ré-écrit pas
  `expires_at_ms` (évite une écriture par lecture). Conséquence : après un reload, le TTL repart de la
  valeur de spawn d'origine, pas du dernier accès. Acceptable v1 (noté). *(F3b pourra persister le
  ré-armement.)*
- **`source_id` = explorateur** : si l'explorateur est absent (ne devrait pas, built-in), `canonical_parent_id`
  rend `kernel` ; la comète/pathBetween restent valides. Pas de spawn sans explorateur attendu.
- **Plafond vs éphémère** : le plafond 20 s'applique à TOUS les auto-spawnés vivants (éphémères) ; le
  plus ancien éphémère se ferme avant d'en ouvrir un 21ᵉ. Les éditeurs **épinglés** (permanents) ne
  comptent pas dans le plafond.
- **Fichier déjà ouvert manuellement** : `editorIdForFile` le trouve → pas de spawn (comète vers lui),
  conforme F2. Le `fileMatch` (suffixe de segments) gère relatif/absolu.

## 7. Tests

- **pytest** (`tests/unit/test_app.py`, section « brique F3a ») : `create_node` avec `ephemeral=true`
  + `expires_at_ms` → node créé avec ces champs ; `POST .../pin` → `ephemeral=False`, `expires_at_ms=None` ;
  `GET /api/canvas` purge un node éphémère expiré (`expires_at_ms` passé) et garde un non-expiré ;
  rétro-compat (un `canvas.json` sans ces champs charge avec les défauts). Modèle `Node` : champs présents.
- **node --test** : si une logique pure est extractible (ex. choix du plus ancien éphémère à recycler /
  décision spawn-vs-dedup), la tester ; sinon, validée par Playwright.
- **Playwright** (`scripts/pw-f3-autospawn.mjs`) : lire un fichier **non ouvert** (ex. un fichier sans
  éditeur) → un node éditeur **apparaît** (fade-in) à l'arrivée de la comète, avec la classe `ephemeral`
  et le bon contenu ; **dedup** : relire → pas de 2ᵉ node ; **épingle** : clic → la classe `ephemeral`
  disparaît, le node reste ; **reload** : l'éditeur éphémère **survit** (non expiré) ; (TTL court de test
  via constante override) → disparaît. 0 erreur console + screenshots.

## 8. Fichiers touchés

- **Backend** : `backend/models.py` (`Node.ephemeral`, `Node.expires_at_ms`) ; `frontend/routes/canvas.py`
  (`NodeCreate` + `create_node` ; endpoint `pin` ; purge dans `GET /api/canvas`) ; `backend/chat/events.py`
  *(non concerné)*. Helper temps : réutiliser `events.now_ms()` ou ajouter un `now_ms()` neutre.
- **Frontend** : `static/js/canvas.js` (`applyIntent` → spawn ; `spawnEphemeralEditor` ; timers TTL au
  rendu ; épingle au clic ; plafond/dedup ; réserve `_spawning`) ; `static/css/canvas.css`
  (`.node-wrap.ephemeral` + fade-in).
- **Tests** : pytest routes/modèle ; `scripts/pw-f3-autospawn.mjs`.

## 9. Suite (F3b)

**F3b — réglages** : `ChatComponent` gagne `spawn_mode` (`ephemeral`|`capped`|`unlimited`), `spawn_ttl_min`,
`spawn_cap` ; le node chat devient `configurable` (engrenage → modale dédiée) ; `canvas.js` lit ces réglages
au lieu des constantes ; modes **plafond+recyclage FIFO** (persistants) et **illimité** (persistants, sans
TTL). Le front passe le mode/TTL/cap effectifs à `spawnEphemeralEditor`.
