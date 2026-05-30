# Tool-cards — modes de rendu (node chat)

Les appels d'outils de Claude (Read / Write / Edit / Bash / Glob / Grep…) s'affichent dans la
bulle « Claude » du chat. Trois modes de rendu ont été maquettés (brainstorming brique D) ;
**on les implémentera tous les trois, sélectionnables dans les réglages du node chat**. Le
premier livré est **C (log terminal)**.

## Palette TOOL_META (commune aux 3 modes)

| Outil | Icône | Couleur |
|---|---|---|
| Read | 📄 | bleu `#4d8dff` |
| Edit | ✏️ | ambre `#ffce6e` |
| Write | 💾 | vert `#3ba55d` |
| Bash | ▸ | teal `#45d6c2` |
| Glob / Grep | 🔍 / 🔎 | violet `#b388ff` |
| LS | 📁 | gris `#8893a7` |
| (bloqué) | 🚫 | rouge `#e5484d` |

États : fait `✓` · en cours `⟳` · erreur `✗` · **bloqué** `🚫` (hors-repo, refusé par le confinement).

## Mode C — Log terminal *(livré en premier)*

Lignes monospace regroupées dans un bloc « console » sous le texte de Claude :
`▸ Bash(pytest -q) ⟳ en cours` · `📄 Read(store.py) ✓ 73 l.` · `🚫 Read(C:\Windows\hosts) bloqué · hors repo`.
Sortie / diff dépliables (`▾`). Très dev, ultra-compact, se groupe bien quand Claude enchaîne
beaucoup d'outils dans un même tour.

## Mode A — Ligne compacte *(futur, réglage)*

Un outil = une **ligne fine** : icône teintée + nom + arg clé + statut à droite ; résultat
dépliable au clic (ex. `+2 −1 ▾` pour un Edit, `✓ 73 l.` pour un Read). Dense, lisible, garde
le côté « cartes colorées » demandé initialement.

## Mode B — Carte détaillée *(futur, réglage)*

Chaque outil = une **carte** : en-tête (icône + nom + chemin + statut) puis **corps** riche —
mini-diff coloré pour Edit/Write, sortie pour Bash, extrait pour Read/Grep. Le plus informatif
(on voit ce que Claude change/obtient sans cliquer), mais vertical ; repliable par défaut si
Claude enchaîne beaucoup d'outils.

## Réglage (futur)

Le mode de rendu sera un champ du `ChatComponent` (ex. `tool_card_style: "log" | "compact" | "card"`,
défaut `"log"`), modifiable via la modale de réglages du node (rendre le node chat `configurable`).
Le mapping `TOOL_META` (icône + couleur) est partagé par les trois modes.
