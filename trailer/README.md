# trailer — mekistudio

Trailer produit **muet, 1920×1080, ≈ 1 min 29**, généré sans éditeur vidéo ni
rush externe : une page HTML **déterministe** dans le langage visuel du produit
(elle réutilise la **vraie** `canvas.css`, le module **réel** `cables.js` pour la
géométrie des câbles 45°, et `marked`/`purify` pour le markdown du chat), capturée
**frame par frame** par Playwright puis encodée en MP4 par ffmpeg.

## Ce qu'on voit

Logo → un canvas vivant où *tout est un node* → une vraie session **Claude** qui
stream dans le node chat → Claude **lit des fichiers** : des comètes parcourent les
câbles et **matérialisent** les éditeurs (brique F3a) → le **courant** circule dans
les câbles → features → vision + `uvx mekistudio serve`.

## Reproduire

```bash
# prérequis : ffmpeg sur le PATH ; playwright + chromium
python trailer/build.py          # render déterministe -> out/trailer.mp4 + poster.png + preview.gif
```

Autres commandes :

```bash
python trailer/render.py --at 30000,52000      # inspecter des keyframes -> frames/at_<ms>.png
# ouvrir trailer/trailer.html?debug=1 dans un navigateur : scrub à la souris (axe X = temps)
```

## Déterminisme (ne pas casser)

Toute la motion est **fonction pure de `t`** via `window.seek(t)` ; `seekFrame(t)`
épingle en plus les `@keyframes` CSS. Aucune horloge murale (`Date.now`, etc.).
Régler le timing dans le bloc *HARNESS* de `trailer.html` (`DUR`, `SC`, `STAGE_*`)
puis re-caler les nombres ms des fonctions `draw*` concernées.

`frames/` et `out/*.mp4` sont **gitignorés** (lourds/régénérables) ; on versionne
`poster.png` + `preview.gif`.
