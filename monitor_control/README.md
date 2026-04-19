# Lucibox Monitor

TUI de monitoring temps réel pour le Raspberry Pi Lucibox, lancé depuis un Mac.  
Connexion SSH au RPi, surveillance des services audio, logs live, et actions de contrôle — le tout dans un terminal.

---

## Stack

| Outil | Rôle |
|---|---|
| Node.js | Runtime |
| `blessed` | TUI (boxes, boutons, scroll, popups) |
| `ssh2` | Connexion SSH — exec one-shot + streams persistants |

---

## Démarrage rapide

```bash
cd monitor_control
npm install
node index.js
```

Au premier lancement, si `monitor_config.json` est absent, l'app affiche un formulaire pour saisir l'hôte et les credentials SSH.

---

## Écrans

### Runtime (écran par défaut)

Trois colonnes :

| Colonne | Contenu |
|---|---|
| Gauche (25%) | Status services (`jack`, `lucibox-node`, `lucibox-pd`), CPU temp/usage, compteur XRUN, scheduling RT, version git, boutons d'action |
| Centre (37.5%) | Logs live `lucibox-node` (journalctl, colorisés par niveau) |
| Droite (37.5%) | Logs live `lucibox-pd` (journalctl, colorisés par type) |

Raccourcis clavier : `[r]` Refresh · `[c]` Config · `[Tab]` Focus logs · `[q]` Quitter

### Config Check (écran 2)

Liste de vérifications système du RPi : OS, kernel RT, CPU governor, groupes user, RT limits, services, port série Arduino, sudoers NOPASSWD.  
Accès : touche `[c]` · Retour : `[Esc]`

---

## Structure des fichiers

```
monitor_control/
├── index.js                  # Point d'entrée — init blessed, SSH, routing écrans
├── monitor_config.json       # Credentials SSH (local Mac, non commité)
│
├── modules/
│   ├── ConfigLoader.js       # Lecture / sauvegarde de monitor_config.json
│   ├── SSHManager.js         # Connexion SSH partagée, exec(), streams, reconnexion backoff
│   ├── SSHPoller.js          # Polling SSH générique à intervalle (émet 'data')
│   ├── StatusPoller.js       # Orchestre tous les polls métriques (services, CPU, RT, git)
│   ├── XrunCounter.js        # Compteur XRUN live via stream journalctl jack
│   ├── ActionRunner.js       # Exécution des actions boutons (restart, reboot, git pull)
│   ├── LogColorizer.js       # Colorisation des lignes de logs node / pd
│   └── OutputParsers.js      # Parsers purs pour toutes les sorties de commandes SSH
│
├── ui/
│   ├── Header.js             # Barre titre + badge statut SSH
│   ├── StatusBar.js          # Barre bas — hints raccourcis clavier
│   ├── StatusColumn.js       # Colonne gauche — métriques et boutons
│   ├── NodeLogColumn.js      # Colonne centre — logs node + bouton Restart
│   ├── PdLogColumn.js        # Colonne droite — logs pd + bouton Restart
│   ├── LogPanel.js           # Widget log scrollable (auto-scroll, buffer 50ms)
│   └── ConfirmPopup.js       # Dialog modale Oui/Non (focus défaut = Non)
│
└── screens/
    ├── RuntimeScreen.js      # Écran principal — câblage composants + touches
    └── ConfigCheckScreen.js  # Écran diagnostic — checks SSH + affichage résultats
```

---

## Configuration SSH

Le fichier `monitor_config.json` est créé localement sur le Mac et ignoré par git :

```json
{
  "host": "patchbox.local",
  "port": 22,
  "username": "patch",
  "password": "raspberry"
}
```

## Notes d'implémentation

Voir [IMPL.md](./IMPL.md) pour les détails techniques : architecture SSH, stratégie de reconnexion, gestion du scroll manuel dans blessed, buffering des lignes journalctl, et commandes SSH recommandées (vmstat vs top, pgrep -o, chrt).
