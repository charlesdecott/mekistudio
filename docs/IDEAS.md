# Boîte à idées — mekistudio

Features envisagées mais **pas encore planifiées**. Notées au fil de l'eau pour
ne rien perdre ; à promouvoir dans `ROADMAP.md` quand on décide de les faire.

## Node éditeur de fichiers (`fileEditor`) — base

Lire / éditer / sauvegarder un fichier façon VSCode : coloration syntaxique
(mots-clés), guides de blocs d'indentation. **Node socle** dont on dérive les
suivants. _(Prochain à implémenter.)_

### Dérivés

- **Éditeur Markdown + preview** : édition à gauche, rendu à droite (graphes
  type mermaid, images, tableaux, etc.).
- **Diff du fichier vs HEAD** : afficher la diff git du fichier par rapport au
  dernier commit (lecture seule + couleurs add/del).
- **Comparaison de 2 implémentations** : diff côte à côte de deux fichiers /
  deux versions pour comparer des approches.

> Ces dérivés partagent le moteur d'édition/coloration du `fileEditor` (réutilisation
> des composants, comme la vision lego). On les sortira un par un, spec → TDD → merge.

## Canvas — anti-chevauchement & collision « douce » des nodes

Les nodes ne doivent **en aucun cas se superposer**. Quand on déplace un node et
qu'un autre se trouve sur son chemin, appliquer un **effet de collision léger** :
le node percuté est poussé hors du passage (animation douce) pour laisser passer
le node déplacé, au lieu de le laisser le recouvrir. Esprit « on écarte les
meubles » : invariant *zéro recouvrement* maintenu en continu.

> Points à trancher en spec : le node poussé **reste-t-il écarté** ou **revient-il**
> après le passage ? la poussée se **propage-t-elle en chaîne** (cascade) quand
> plusieurs nodes sont alignés ? s'applique-t-elle aussi au **redimensionnement**
> et au **spawn** (aujourd'hui les éditeurs se chevauchent *volontairement* en
> cascade — cf. `openFileInNewEditor`/`editorPosAt`) ? le `kernel` figé fait
> office de **mur**.

## Canvas — relier les nodes avec une logique (wires)

J'aimerais **relier les nodes entre elles avec une certaine logique** (sortie d'un
node → entrée d'un autre), pour matérialiser le flux qui circule sur le canvas.
Pour le tracé des fils, on partira sur la méthode **subway + ribbon** (segments à
45° + regroupement des fils parallèles en ruban — cf. `docs/raw/cables/ue5_cablemanagement.md`).

## Chat — hooks → impulsions (F1+F2) : polish différé

Mineurs relevés par la revue finale du Spec 1, non bloquants, à reprendre plus tard :

- **Flash rouge parasite sur interruption** : un `Stop` avec des outils en vol émet un
  `tool_result(is_error=True, "interrompu")` synthétique par outil → autant de flashs rouges
  « erreur » sur le chat. La spec réserve le rouge aux refus/échecs. → marquer ces résultats
  d'interruption autrement (statut distinct) pour que `impulseFor` ne les traite pas comme erreur.
- **Comète gelée en onglet caché** : `animateComet` repose sur `requestAnimationFrame` (gelé en
  arrière-plan) → `_activePulses` peut rester incrémenté et atteindre le plafond 24, bloquant les
  comètes. Auto-réparé au retour au premier plan, mais les comètes émises pendant le gel sont
  perdues. → timeout de garde qui résout l'animation, ou ne compter que les comètes démarrées à l'écran.
- **Glow Stop / Notification perdu au reconnect** : `turn_end`/`hook_fired` sont transients (non
  rejoués) → si la WS est déconnectée à la fin du tour, pas de glow d'acquittement à la reconnexion
  (conforme spec §6, mais l'acquittement Stop devient best-effort). → dériver le glow au reattach
  depuis l'état durable si le dernier tour n'a pas été acquitté.
- **Glow Stop écrasé avant acquittement** : un glow auto-fade ultérieur sur le chat (ex. flash
  d'erreur du tour suivant) efface le glow Stop persistant non cliqué. → ne pas laisser un glow
  transitoire écraser un glow dismissable en attente.
- **`data-file` figé au rendu** : `wrap.dataset.file` n'est posé qu'au `renderNode` ; si le fichier
  d'un éditeur change en place sans re-render, `editorIdForFile` vise l'ancien chemin. Latent
  aujourd'hui, **à traiter en F3** (réutilisation/spawn d'éditeur).
- **Ambiguïté multi-chat** : `applyIntent` résout toujours le 1er node `chat` (`kindId('chat')`) ;
  sans impact tant qu'il n'y a qu'un chat, mais à corriger si on duplique le node chat (passer le
  `nodeId` émetteur dans le `CustomEvent`).
- **Glow-notif inerte** : `Notification` ne fire pas en session lecture seule (cf. smoke) → le
  glow-notif persistant n'est démontré qu'avec un vrai `Notification` (lié à la **brique E** askUser).
