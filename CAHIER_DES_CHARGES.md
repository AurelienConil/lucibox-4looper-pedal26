# Cahier des charges — Lucibox 4looper

Version du document : 1.0 — 2026-09-26
Statut : brouillon, à valider. Les points ouverts sont marqués **[?]**.

Ce document décrit le **système** Lucibox. Le moteur de looper est l'external **`lucilooper~`**, un
projet à part (`~/Documents/Pd/externals-perso/lucilooper`) : son cahier des charges complet est dans son
`CLAUDE.md`. Ici, on ne reprend que son interface.

---

## 1. Contexte

La Lucibox 4looper est une pédale guitare à 4 voies de looper tournant sur Raspberry Pi (JACK, Pd temps réel).

```
Arduino (boutons pied, potars, LEDs) ─serial─▶ bridge Node/Rust ─OSC─▶ Pure Data ─▶ [lucilooper~ 4]
```

Problèmes de l'ancien système, qui motivent la refonte :

- Synchronisation des voies faite dans Pd par `[metro]` (ms, thread message) alors que chaque voie vit dans
  le thread audio (échantillons) : deux horloges, des rustines, des dérives.
- Notion maître/esclave par voie, alors que la synchro est un sujet global.
- État de chaque voie dupliqué dans le patch (`sv`, `visual_state`, metros de LED par voie).
- Mapping bouton → action fait hors du moteur, à partir d'une copie de l'état parfois en retard.
- États « d'affichage » mélangés aux états audio.
- Beaucoup de dette : UI Pd, anciens modes, Ableton Link à moitié câblé, save/load trop complexe.

## 2. Démarche : table rase sur la partie audio

**Refait de zéro :**
- le moteur : `lucilooper~`, qui n'est ni une refonte ni une copie de `myLooper~` ;
- le patch Pure Data : un nouveau patch minimal, qui ne reprend rien des patchs actuels
  (`_main.pd`, `machine.pd`, `patches/*`).

**Conservé, car sain :**
- le firmware Arduino (boutons, potars, LEDs, protocole serial), avec deux ajouts : couleur de LED selon
  l'état d'une voie, animations brèves sur événement (voir 6) ;
- le bridge Node, et son portage Rust ;
- l'interface OSC `/lucibox/...`, étendue si besoin (voir 6).

**Règles :**
- L'ancien code audio ne sert pas de base de travail. On ne garde que les leçons (section 1).
- Toute fonctionnalité absente de ce document (ou du cahier de `lucilooper~`) est abandonnée.

## 3. Principes du système

1. **Une seule horloge**, celle de `lucilooper~`. Pas de `metro`, pas de tempo calculé dans Pd.
2. **Pas de copie d'état hors du moteur.** Le patch, les LEDs et la web UI réagissent aux événements de
   `lucilooper~` ; pour se resynchroniser, ils demandent un `dump`.
3. **L'extérieur envoie des gestes, pas des actions.** Le patch transmet `rec`, `play`, `clear`,
   `global_play`, `global_clear` sans les interpréter ; c'est le moteur qui décide selon l'état exact.
4. **Pas d'état d'affichage.** Couleur = état ; animation = événement.

## 4. Répartition des responsabilités

| Couche | Rôle |
|---|---|
| Arduino | Lit boutons et potars, envoie les press / release bruts, affiche les LEDs (couleur par état, animation par événement). |
| Bridge (Node → Rust) | Pont serial ↔ OSC, serveur web, commandes système. Aucune logique musicale. |
| Pd | Réception OSC, **détection appui court / long** (voir 5), transmission des gestes à `lucilooper~`, effets, volumes, mix, `dac~`, renvoi des événements en OSC. Pas d'UI Pd. |
| `lucilooper~` | Transport, voies, résolution des gestes par sa table de règles, enregistrement / lecture / overdub, quantification, événements. |
| Web (via bridge) | Future interface graphique (état, réglages, banque). |

---

## 5. Gestes et détection des appuis (dans Pd)

| Geste | Bouton physique | Moment d'émission |
|---|---|---|
| `rec <n>` | REC n | au **press**, sans aucun délai |
| `play <n>` | PLAY n, appui court | au **release**, si avant le seuil d'appui long |
| `clear <n>` | PLAY n, appui long | au **seuil**, bouton encore enfoncé |
| `global_play` | GLOBAL, appui court | au **release**, si avant le seuil d'appui long |
| `global_clear` | GLOBAL, appui long | au **seuil**, bouton encore enfoncé |

- **REC : aucune latence acceptable.** Le release est ignoré.
- **PLAY et GLOBAL : un bouton, deux fonctions.** Au press, un délai « appui long » démarre (seuil
  paramétrable) ; release avant le seuil → geste court, délai annulé ; seuil atteint → geste long, et le
  release qui suit n'émet rien. Un appui produit **exactement un** geste.
- La latence de `play` et `global_play` (durée de l'appui) est acceptée.
- Cette mise en forme n'est pas de la logique musicale : elle peut migrer dans le firmware ou le bridge
  sans rien changer au moteur.

## 6. Nouveau patch Pd de la V1

Le patch est écrit de zéro et contient seulement :

- la réception OSC (`netreceive` / `oscparse`) ;
- la détection appui court / long (section 5), puis l'envoi des gestes à `lucilooper~` ;
- un seul `[lucilooper~ 4]` ;
- les volumes et effets pilotés par les potars ;
- le mix et la sortie `dac~` ;
- l'envoi OSC des événements vers le bridge (LEDs, web UI) ;
- un `dump` au chargement du patch, pour initialiser les LEDs.

Pas d'UI Pd, pas de `sv`, pas de metro, pas de tempo calculé dans Pd, pas de copie de l'état des voies.

**LEDs**, au plus simple :
- **État → couleur** : Pd envoie un message OSC par transition (`/lucibox/led/voice <n> <state>`). Le
  firmware associe à chaque état une couleur fixe et fait clignoter seulement les états armés
  (`rec_armed`, `rec_ending`, `play_armed`).
- **Événement → animation** : Pd relaie les événements ponctuels
  (`/lucibox/led/event <n> <cleared|cancelled|aborted|refused>`). Le firmware joue une animation brève
  (quelques dizaines de ms) par-dessus la couleur de l'état, sans effet sur le moteur.
- Plus aucun metro de LED dans Pd, pas de motif lié au tempo en V1.

## 7. Interface de `lucilooper~` (résumé)

Référence complète : `lucilooper/CLAUDE.md`.

```
[lucilooper~ 4 60]      4 voies, 60 s max par voie
entrée gauche : signal mono (guitare) + messages
sorties       : 4 signaux mono (un par voie), puis la sortie d'événements
```

| Message | Effet |
|---|---|
| `rec <n>`, `play <n>`, `clear <n>` | Gestes de voie (n = 1..4) |
| `global_play`, `global_clear` | Gestes globaux |
| `tempo <bpm> <beats>` | Impose le tempo avant d'enregistrer ; `tempo 0` l'oublie |
| `feedback <0..1>`, `overdub_level <0..1>` | Réglages d'overdub |
| `trace <0/1>` | Trace de résolution des gestes (debug) |
| `pos` | Position de chaque voie (barre de progression) |
| `dump` | Réémet l'état complet |
| `action <nom> [<n>] [cycle]` | Action directe (web UI, tests) |

Événements, toujours préfixés par le canal (`1..4` = voie, `0` = global) → un seul `[route 0 1 2 3 4]` :

```
3 state playing        0 transport running
3 length 2             0 cycle 12
3 cleared              0 beat 2 4
3 cancelled            0 tempo 96000 120 4
3 aborted              0 refused tempo
3 refused end_rec      0 gesture global_play 0
3 gesture rec 4        0 overflow
3 pos 48000 96000
```

États de voie : `empty rec_armed recording rec_ending playing overdub play_armed stopped`.
États du transport : `no_tempo defining idle running stopped`.

Comportements utiles côté système :
- La première boucle enregistrée (boucle libre) définit le tempo ; les suivantes sont quantifiées au cycle.
- Une boucle ne démarre jamais depuis son milieu : les démarrages se font au début d'un cycle.
- `global_play` arrête tout immédiatement ; la relance repart de zéro, toutes les boucles depuis leur début.
- `global_clear` efface tout ; un tempo de boucle libre est alors oublié, un tempo imposé est conservé.

## 8. Exigences du système

- Aucun clic audible (démarrage, arrêt, bouclage, clear) — garanti par le moteur, à vérifier sur la pédale.
- Fonctionnement identique Mac / Pi ; validation finale sur le Pi (48 kHz, JACK, `-blocksize 128`).
- Les LEDs et la web UI ne dépendent que des événements (et de `dump`), jamais d'une copie d'état.

---

## 9. Fonctionnalités souhaitées (post-V1)

### 9.1 Save / recall — banque de 10

- Sauvegarder l'état complet (toutes les voies + `L` + BPM + sr) dans un slot 1–10 ; recharger un slot.
- Format : un WAV par voie + un JSON de métadonnées par slot :

  ```
  bank/03/meta.json   { "sr":48000, "L":96000, "bpm":120, "beats":4,
                        "voices":[{"k":1},{"k":2},null,{"k":1}] }
  bank/03/voice1.wav …
  ```
- Export / import de loops isolées en WAV.
- Aucune I/O dans le thread audio : le moteur fournira `snapshot` et `load` (voir son cahier).
- Fréquence du fichier différente : refus en V1, rééchantillonnage plus tard. **[?]**

### 9.2 Autres souhaits

- **Undo** de la dernière couche d'overdub, via un nouveau geste (ex. appui long sur REC).
- **Gestes supplémentaires** (double appui, combinaisons) : mise en forme dans Pd + règles dans le moteur.
- **Tolérance de retard** sur les appuis juste après un début de cycle (dans le moteur).
- **Web UI** : état des voies, tempo, progression, banque, réglages.
- **Métronome** : voir points ouverts.
- **Synchro externe** (Ableton Link, MIDI clock, entre deux Lucibox), stéréo : ouvertures prévues dans le
  moteur.

## 10. Hors périmètre

- Time-stretch, pitch-shift dans le moteur (les effets restent dans Pd).
- Les anciens modes d'enregistrement (autosync, no-overdub, metronome) : externals séparés s'ils reviennent.
- L'UI Pd.

## 11. Points ouverts

1. Seuil de l'appui long sur PLAY et GLOBAL (valeur actuelle du patch à reprendre).
2. Effets de la V1 : lesquels (reverb, octaver, délai…), par voie ou globaux, quel potar pilote quoi ?
   Réécrits ou choisis à neuf.
3. Durée max par voie (défaut 60 s) et budget mémoire sur le Pi (undo inclus).
4. **Métronome / horloge** : proposition en cours dans le cahier de `lucilooper~` (démarrage du transport
   sans boucle en tempo imposé, sortie signal « horloge »). Le clic lui-même serait fait dans Pd.
5. Comportements réglables dans la table du moteur (cellules **[?]** du cahier de `lucilooper~`) : à
   trancher à l'usage, au pied.

**Décidés :**
- ~~Emplacement du moteur~~ → external `lucilooper~`, projet séparé, écrit de zéro.
- ~~Mapping des boutons~~ → Pd envoie des gestes, le moteur les résout par sa table de règles.
- ~~Timing des appuis~~ → `rec` au press ; `play` / `global_play` au release d'un appui court ;
  `clear` / `global_clear` au seuil d'appui long ; détection dans Pd.
- ~~Motifs de LEDs~~ → couleur fixe par état, clignotement des états armés, animation brève sur événement,
  dans l'Arduino.
- ~~Effacer tout~~ → `global_clear` (appui long sur GLOBAL).
- ~~Lire l'état du looper~~ → pas de lecture directe ; événements + `dump` pour se resynchroniser.
